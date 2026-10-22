import { JjPanelService, type JjPanelConfig } from "./service.js";

export { JjPanelService } from "./service.js";
export type { JjPanelConfig, JjPanelRequest } from "./service.js";
export * from "./types.js";

/** Bundle row name; must match the installed package name. */
export const name = "jj-panel";

/** No required services: the plugin degrades to cwd-unavailable without them. */
export const inject: string[] = [];

export function apply(ctx: unknown, config: unknown): void {
  new JjPanelService(ctx, (config ?? {}) as JjPanelConfig);
}
