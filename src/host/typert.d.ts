/**
 * Minimal declarations for the harness-side modules this plugin imports.
 *
 * They are provided by the DSH runtime (the loader resolves them from the
 * harness's own module graph), not installed from npm, so the package declares
 * them as peer dependencies instead of shipping copies.
 */
declare module "@deepseek-ai/dsh-typert-protocol" {
  export type ClassMethodDecoratorContextLike = {
    kind: "method";
    name: string | symbol;
    static: boolean;
    private: boolean;
    addInitializer(initializer: (this: unknown) => void): void;
  };

  export function Remote(
    name: string
  ): <T>(value: T, context: ClassMethodDecoratorContextLike) => void;

  export class TypertRemoteService {
    constructor(ctx: unknown, serviceKey: string, options?: { namespace?: string });
  }
}
