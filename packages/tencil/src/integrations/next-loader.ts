import { addSourceAttributes, repositoryRoot } from './source-attributes.ts';

/** What webpack and Turbopack hand a loader; only the parts used here. */
interface LoaderContext {
    resourcePath: string;
    rootContext?: string;
    async(): (error: Error | null, code?: string, map?: unknown) => void;
}

let root: string | undefined;

/**
 * webpack / Turbopack loader for `withTencil`: adds `data-tencil-src` to the
 * elements of a .jsx/.tsx file before Next compiles it.
 */
export default function tencilSourceLoader(this: LoaderContext, source: string): void {
    const callback = this.async();
    root ??= repositoryRoot(this.rootContext ?? process.cwd());
    addSourceAttributes(source, this.resourcePath, root).then(
        result => (result ? callback(null, result.code, result.map) : callback(null, source)),
        (error: Error) => callback(error),
    );
}
