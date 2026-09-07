import {expect,it} from 'vitest';
import {isWheelZoomGesture} from './wheelZoom';
it('reserves wheel zoom for Ctrl and leaves ordinary, horizontal and Cmd-only gestures alone',()=>{
  expect(isWheelZoomGesture({ctrlKey:false,deltaY:100})).toBe(false);
  const commandOnly={ctrlKey:false,metaKey:true,deltaY:-100};
  expect(isWheelZoomGesture(commandOnly)).toBe(false);
  expect(isWheelZoomGesture({ctrlKey:true,deltaY:0})).toBe(false);
  expect(isWheelZoomGesture({ctrlKey:true,deltaY:-100})).toBe(true);
  expect(isWheelZoomGesture({ctrlKey:true,deltaY:100})).toBe(true);
});
