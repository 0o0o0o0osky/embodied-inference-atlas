#!/usr/bin/env node
// Capture an existing local analysis route. Browser binaries stay outside Git.
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const help = `Render an offline analysis for visual review.
Usage: node tools/render_review.mjs --url URL [options]
  --output DIR              Artifact directory under .local/ (default .local/ui-review)
  --viewport WIDTHxHEIGHT   Default 1600x1000
  --selector CSS            Capture one existing panel; otherwise capture the viewport
  --browser PATH            Existing Chromium executable (or ATLAS_BROWSER_EXECUTABLE)
  --playwright-module PATH  Existing Playwright module (or ATLAS_PLAYWRIGHT_MODULE)
  --help                    Show help; no browser or package installation
Use a route URL with the intended model, input, runtime and selection.
The script rejects remote assets and writes screenshot.png plus review.json.
Inspect the image and check selection/return interactions in the browser.`;

const options = {};
for (let i=2; i<process.argv.length; i++) {
  const key=process.argv[i];
  if (key==='--help') { process.stdout.write(help+'\n'); process.exit(0); }
  if (!['--url','--output','--viewport','--selector','--browser','--playwright-module'].includes(key) || !process.argv[i+1] || process.argv[i+1].startsWith('--')) throw new Error(`Invalid option: ${key}\n${help}`);
  options[key.slice(2)]=process.argv[++i];
}
if (!options.url) throw new Error(help);
const localHost = value => ['localhost','127.0.0.1','[::1]'].includes(value);
const url=new URL(options.url);
if (!['http:','https:'].includes(url.protocol) || !localHost(url.hostname)) throw new Error('Use the local HTTP build server.');
const match=/^(\d+)x(\d+)$/.exec(options.viewport ?? '1600x1000');
if (!match || Number(match[1])<320 || Number(match[2])<240) throw new Error('Expected viewport WIDTHxHEIGHT, at least 320x240.');
const viewport={width:Number(match[1]),height:Number(match[2])};
const output=resolve(options.output ?? '.local/ui-review');
const localPath=relative(resolve('.local'),output);
if (localPath.startsWith('..') || isAbsolute(localPath)) throw new Error('Keep review artifacts under .local/.');
const modulePath=options['playwright-module'] ?? process.env.ATLAS_PLAYWRIGHT_MODULE;
const {chromium}=await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
const executablePath=options.browser ?? process.env.ATLAS_BROWSER_EXECUTABLE;
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const remote=[], errors=[], failedResponses=[];
try {
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  await context.route('**/*',route=>{
    if (!localHost(new URL(route.request().url()).hostname)) { remote.push(route.request().url());return route.abort(); }
    return route.continue();
  });
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{ if(response.status()>=400) failedResponses.push({url:response.url(),status:response.status()}); });
  await page.goto(url.href,{waitUntil:'networkidle'});
  await page.evaluate(()=>document.fonts.ready);
  await mkdir(output,{recursive:true});
  if (options.selector) {
    const panel=page.locator(options.selector);
    await panel.waitFor({state:'visible'});
    await panel.screenshot({path:resolve(output,'screenshot.png')});
  } else await page.screenshot({path:resolve(output,'screenshot.png')});
  const report={url:page.url(),viewport,selector:options.selector ?? null,remote,errors,failedResponses};
  await writeFile(resolve(output,'review.json'),JSON.stringify(report,null,2)+'\n');
  if (remote.length || errors.length || failedResponses.length) throw new Error(`Render checks failed. See ${relative(process.cwd(),output)}/review.json`);
  process.stdout.write(`Rendered ${relative(process.cwd(),output)}/screenshot.png; no remote assets or page errors.\n`);
} finally { await browser.close(); }
