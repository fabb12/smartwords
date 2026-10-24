// Vite asset imports (e.g. the PDF worker): the module resolves to the file's URL.
declare module '*?url' { const src: string; export default src; }
// Raw text imports (e.g. the files of the LaTeX template): the module resolves to the file's content.
declare module '*?raw' { const text: string; export default text; }
