# What is this?

If there's some JS code that uses fetch, and you want to make it work offline (mix offline and online), this is a tool for that.

# How to use

## If you're trying to make an npm package work offline (for others)

```sh
# Install this cli tool:
deno install -n offjs -Afgr https://raw.githubusercontent.com/jeff-hykin/offline_fetch_shim/master/cli.js

# create a place to download the files
mkdir -p offline_clang
cd offline_clang

# use the cli tool
npm_module_name="@yowasp/clang"
offjs "$npm_module_name"

#
# record the fetches (online)
#
# load the ./$npm_module_name.recorder.js file
deno repl
> import { runClang } from './@yowasp_clang.recorder.js'
> // cause the NPM module to trigger fetch-requests (this step is different for each NPM module)
> var { hello } = await runClang(['clang++', 'test.cc', '-o', 'hello'], {"test.cc": `#include <iostream>\nint main() { std::cout << "hello" << std::endl; }`})
> // ^this causes fetches, which then get recorded and dumped to a file system
> ctrl+C

# 
# bundle the recording (offline)
# 
deno bundle ./@yowasp_clang.replayer.js > offline_bundle.js
# send that bundle to whoever, and they won't need internet to use it
```

## If you're using a browser

1. Get the data offline data as a HAR file
    - If the code runs in a browser, open up the broswers debugging window, go to the network tab, reload the page, right click any network request, hover over "copy value", then click "Save all as HAR". (This works on FireFox for sure, but should be available in most browsers)
2. Create a shim of `fetch` in your code this:

```js
import { createFetchShim } from 'https://esm.sh/gh/jeff-hykin/offline_fetch_shim/main.js'

const harData = { /*paste your HAR data here*/ }
// Note: setting the globalThis.fetch is not required, but its likely what will be needing
globalThis.fetch = createFetchShim(harData, { fetch })
```

## If you're using Deno / Bun

First run a simple recording pass. Start the deno repl `deno -A repl` and run:

```js
// setup the fetch-recording
import { printData, getData } from 'https://esm.sh/gh/jeff-hykin/offline_fetch_shim/quick_record.js'
// import LIBRARY YOU WANT TO WORK OFFLINE HERE
// (make sure it triggers the downloads, may have to call methods of the library)

// copy the printed data
printData()
// alternatively, save the data to a file
Deno.writeTextFileSync('fetch_recording.js', `export default ${getData()}`)
```

After the data is recorded, it can be replayed:

```js
import { createFetchShim } from 'https://esm.sh/gh/jeff-hykin/offline_fetch_shim/recorder.js'

const data = { /*paste the printed output here*/ }
// alternatively load the data from a file
import data from './fetch_recording.js'

// shim fetch
globalThis.fetch = createFetchShim(data, { fetch })

// NOTE: if the library is not dynamically imported, there is a problem that the shim will not be active at the time that the library loads
// there are ways around this with bundlers, but that'll be up to you
let library = await import("LIBRARY YOU WANT TO WORK OFFLINE HERE")
```


## Debugging & Options

While lots of times it'll "just work", sometimes you need custom handling.

```js
// start with debugging
// NOTE: this gets called when something doesn't match the cache
const hook = ({ realRequestObject, requestId, idToResponseTable, idToOfflineRequestTable }) => {
    console.debug(`this realRequestObject.url:`,realRequestObject.url)
    console.debug(`this realRequestObject:`,realRequestObject)
    console.debug(`realRequestObject has an id of:`,requestId)
    console.debug(`the cached id's are :`,Object.keys(idToOfflineRequestTable))
    
    // if you know what you want to respond with, you can manually do that here by returning a response object
    // (there's better ways, but sometimes this is enough when you're only patching 1 thing)
    // NOTE: if you need async, then respond with a Promise object (don't make the hook async, otherwise it'll always respond)
    
    // if you want to FORCE everything to be offline, throw an error in this hook
}

// fine grain control
const fetchWithCache = createFetchShim(harData, {
    hookForNonMatchingRequests: hook,
    // How it works:
    //     harDataRequest=>id
    //     realRequest=>id
    //        if id's are the same, then it uses the cache
    
    // you can control the "harDataRequest=>id" part
    convertOfflineRequestToId: (req)=>JSON.stringify({
        url: request.url,
        method: request.method,
        postData: { encoding: request.postData?.encoding, text: request.postData?.text, },
    }),
    
    // you can control the "realRequest=>id" part (this NEEDS to mirror whatever you're doing in the convertOfflineRequestToId)
    convertRequestObjToId: (req)=>{
        let postData = { encoding: undefined, text: undefined }
        if (req.method === 'POST') {
            var requestCopy = req.clone()
            try {
                postData.text = requestCopy.text()
            } catch (error) {
                postData.text = btoa( requestCopy.bytes() )
                postData.encoding = "base64"
            }
        }
        return JSON.stringify({url: req.url, method: req.method, postData})
    },
    
    // optional: control the "harDataResponse=>response" part
    convertOfflineDataToResponseObject: (res)=>{
        const headers = new Headers()
        for (const { name, value } of res.headers) {
            headers.append(name, value)
        }
        if (res.content?.mimeType) {
            headers.set("Content-Type", res.content.mimeType)
        }
        let body = ""
        if (res.content?.text) {
            body = res.content.text
            if (res.content?.encoding === "base64") {
                body = atob(body)
            }
        }
        
        return new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers: headers,
        })
    },
    fetch, // you can tell it to use a fetch different from globalThis.fetch... if you want... for some reason
})
monkeyPatch(globalThis, "fetch", (originalFetch)=>fetchWithCache) // NOTE: no ()'s on fetchReplacement
```