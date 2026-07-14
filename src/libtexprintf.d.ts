declare module "libtexprintf" {
  export interface RenderResult {
    output: string;
    errors: string[];
  }

  export interface RenderFunction {
    (latex: string): RenderResult;
    setFontstyle(style: string): void;
  }

  export interface RenderOptions {
    onError?: (errors: string[]) => void;
    throwOnError?: boolean;
  }

  export function loadInstance(): Promise<WebAssembly.Instance>;
  export function createRender(
    instance: WebAssembly.Instance,
    options?: RenderOptions,
  ): RenderFunction;
}
