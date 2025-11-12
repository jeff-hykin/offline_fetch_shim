#!/usr/bin/env -S deno run --allow-all
import { normalizePath } from 'https://esm.sh/gh/jeff-hykin/good-js@1.18.2.0/source/flattened/normalize_path.js'
import $ from "https://esm.sh/@jsr/david__dax@0.43.2/mod.ts"
import { escapeJsString } from 'https://esm.sh/gh/jeff-hykin/good-js@1.18.2.0/source/flattened/escape_js_string.js'
const $$ = (...args) => $(...args).noThrow()
const npmPackageName = Deno.args[0].replace(/\/+$/,"")

const jsDeliverPath = `https://cdn.jsdelivr.net/npm/${npmPackageName}/`
// await $$`false`
// (await $$`false`).code
// await $$`false`.text("stderr")
// await $$`false`.text("combined")
// await $$`echo`.stdinText("yes\n")
console.debug(`jsDeliverPath is:`,jsDeliverPath)
const packageJson = await (await fetch(`${jsDeliverPath}package.json`)).json()
const pathToMain = normalizePath(getMainFile(packageJson))
const jsDeliverPrefix = FileSystem.dirname(jsDeliverPath+pathToMain).replace(/\/+$/,"")+"/"

const fileText = await $`deno bundle ${jsDeliverPath + pathToMain}`.text()
import { FileSystem, glob } from "https://deno.land/x/quickr@0.8.6/main/file_system.js"
const targetFolder = FileSystem.pwd
const recorderPath = `${targetFolder}/${npmPackageName.replace(/\//g,"_")}.recorder.js`
const replayerPath = `${targetFolder}/${npmPackageName.replace(/\//g,"_")}.replayer.js`
const offlineFilesPath = `${targetFolder}/${npmPackageName.replace(/\//g,"_")}.files.js`
await FileSystem.write({
    path: recorderPath, data: `
const offlineFilesPath = ${escapeJsString(offlineFilesPath)}
const jsDeliverPrefix = ${escapeJsString(jsDeliverPrefix)}
const builtinFetch = eval?.("fetch")
const baseUrl = import.meta.url.split("/").slice(0, -1).join("/")
import { FileSystem, glob } from "https://deno.land/x/quickr@0.8.6/main/file_system.js"
// import { binaryify } from "https://deno.land/x/binaryify@2.5.6.1/binaryify_api.js"
import { pureBinaryify } from "https://deno.land/x/binaryify@2.5.6.1/tools.js"
import { toCamelCase } from 'https://esm.sh/gh/jeff-hykin/good-js@1.18.2.0/source/flattened/to_camel_case.js'
let offlineFilesText = \`
var files = {}
export default files
\`
var globalThis = {...eval?.("globalThis"), fetch: (...args)=>{
    let req = new Request(...args)
    if (req.url.startsWith(baseUrl)) {
        req = new Request(\`\${jsDeliverPrefix}\${req.url.slice(baseUrl.length+1)}\`, req)
        const pwd = ${JSON.stringify(targetFolder)}
        const filePath = req.url.split("/").slice(-1)[0]
        fetch(new Request(req)).then(res=>res.arrayBuffer()).then(
            async (buf)=>{
                const jsFileString = pureBinaryify(buf)
                let path = \`\${pwd}/\${filePath}\`+'.js'
                console.log("writing to path:",path)
                await FileSystem.write({path, data: jsFileString, overwrite: true})
                const varName = toCamelCase(filePath+"_uint8Array")
                offlineFilesText += \`import \${varName} from \${JSON.stringify("./"+filePath+'.js')}\\nfiles[\${JSON.stringify(filePath+'.js')}] = \${varName}\\n\`
                // update the offlineFiles
                await FileSystem.write({path:offlineFilesPath, data: offlineFilesText, overwrite: true})
            }
        ).catch(err=>{
            console.error(\`couldn't fetch \${req.url}\${err}n\`)
        })
    }
    return builtinFetch(req)
}}
var fetch = globalThis.fetch
var process


${fileText}
`, overwrite: true
})

// thing that uses the offline files
await FileSystem.write({
    path: replayerPath, data: `
import files from ${JSON.stringify("./"+FileSystem.basename(offlineFilesPath))}
const builtinFetch = eval?.("fetch")
const baseUrl = import.meta.url.split("/").slice(0, -1).join("/")
import { FileSystem, glob } from "https://deno.land/x/quickr@0.8.6/main/file_system.js"
var globalThis = {...eval?.("globalThis"), fetch: (...args)=>{
    let req = new Request(...args)
    const url = req.url
    if (url.startsWith(baseUrl)) {
        // use the offline files first, but we will fallback to the jsdelivr patch if no files are matched
        req = new Request(\`${escapeJsString(jsDeliverPath).slice(1, -1)}\${req.url.slice(baseUrl.length+1)}\`, req)
        for (const [filePath, fileContents] of Object.entries(files)) {
            if (url.endsWith("/"+filePath)) {
                const headers = {}
                if (filePath.endsWith(".js.js")) {
                    headers['content-type'] = 'application/javascript'
                } else if (filePath.endsWith(".json.js")) {
                    headers['content-type'] = 'application/json'
                } else if (filePath.endsWith(".txt.js")) {
                    headers['content-type'] = 'text/plain'
                } else if (filePath.endsWith(".wasm.js")) {
                    headers['content-type'] = 'application/wasm'
                }
                return Promise.resolve(new Response(fileContents, {
                    status: 200,
                    statusText: "ok",
                    headers,
                    url: req.url,
                }))
            }
        }
    }
    console.log(\`fetching \${req.url}\`)
    return builtinFetch(req)
}}
var fetch = globalThis.fetch
var process


${fileText}
`, overwrite: true
})
console.log(`in a repl run:\n`)
console.log(`import * as thing from ${JSON.stringify(recorderPath)}`)
console.log(`\n// then, after loading stuff, try bundling:\n`)
console.log(`import * as thing from ${JSON.stringify(replayerPath)}`)


/**
 * Get the main entry path of a package.json, preferring ESM.
 * @param {object} pkg - The parsed package.json object.
 * @returns {string|null} Path to the main entry file, or null if none found.
 */
function getMainFile(pkg) {
    if (!pkg || typeof pkg !== 'object') return null;

    // Helper to extract a string path safely
    const asPath = val => typeof val === 'string' ? val : null;

    // 1. Handle the "exports" field (can be string or object)
    if (pkg.exports) {
        if (typeof pkg.exports === 'string') {
            // Single export — likely ESM if package.type = module
            return asPath(pkg.exports);
        } else if (typeof pkg.exports === 'object') {
            // Look for ESM exports first
            if (pkg.exports.default) return asPath(pkg.exports.default);
            if (pkg.exports.import) return asPath(pkg.exports.import);
            if (pkg.exports.require) return asPath(pkg.exports.require);

            // Sometimes there's a "." key for root export
            const rootExport = pkg.exports['.'];
            if (rootExport) {
                if (typeof rootExport === 'string') return asPath(rootExport);
                if (typeof rootExport === 'object') {
                    // Prefer ESM ("import") over CJS ("require")
                    if (rootExport.import) return asPath(rootExport.import);
                    if (rootExport.default) return asPath(rootExport.default);
                    if (rootExport.require) return asPath(rootExport.require);
                }
            }
        }
    }

    // 2. Next preference: "module" field (commonly ESM)
    if (pkg.module) return asPath(pkg.module);

    // 3. "browser" sometimes points to a bundle (prefer if ESM type)
    if (pkg.browser && typeof pkg.browser === 'string') {
        if (pkg.type === 'module') return asPath(pkg.browser);
    }

    // 4. "main" field (CommonJS, fallback)
    if (pkg.main) return asPath(pkg.main);

    // 5. Default fallback based on package type
    if (pkg.type === 'module') return './index.js';
    return './index.cjs';
}