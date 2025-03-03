# What is this?

If there's some JS code that uses fetch, and you want to make it work offline (mix offline and online), this is a tool for that.

# How to use

1. Get the data offline data  
    - If the code runs in a browser, open up the broswers debugging window, go to the network tab, reload the page, righ click any network request, hover over "copy value", then click "Save all as HAR". (This works on FireFox for sure, but should be available in most browsers ])
2. Create a shim of `fetch` in your code this:

```js
import { createFetchShim, monkeyPatch } from 'https://esm.sh/gh/jeff-hykin/offline_fetch_shim/main.js'

const harData = { /*paste your HAR data here*/ }
const fetchWithCache = createFetchShim(harData, { fetch })
// if you control the getting-shimmed code, then just call the variable "fetch" at the top of the file

// if you don't control it, then you can monkey patch globalThis.fetch, and then import it
// NOTE: if it doesn't match anything in the HAR data, it will just use the ONLINE/original fetch
monkeyPatch(globalThis, "fetch", (originalFetch)=>fetchWithCache) // NOTE: no ()'s on fetchReplacement
```


## Debugging & Options

While lots of times it'll "just work", sometimes you need custom handling. We've got all the custom handling.

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