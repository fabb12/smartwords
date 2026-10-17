// Vite asset imports (e.g. the PDF worker): the module resolves to the file's URL.
declare module '*?url' { const src: string; export default src; }
