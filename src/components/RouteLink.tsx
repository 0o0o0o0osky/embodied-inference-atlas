import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

import {
  isPlainNavigation,
  routeHref,
  type RoutePatch,
  type RouteState,
} from "../app/routes";

interface RouteLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  children: ReactNode;
  route: RouteState;
  patch: RoutePatch;
  navigate: (patch: RoutePatch, replace?: boolean) => void;
}

export function RouteLink({
  children,
  route,
  patch,
  navigate,
  onClick,
  ...anchorProps
}: RouteLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented && isPlainNavigation(event)) {
      event.preventDefault();
      navigate(patch);
    }
  };

  return (
    <a {...anchorProps} href={routeHref(route, patch)} onClick={handleClick}>
      {children}
    </a>
  );
}
