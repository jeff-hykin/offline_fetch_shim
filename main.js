// based on:
    // (yeah it says "dont use" but whatever)
    // https://w3c.github.io/web-performance/specs/HAR/Overview.html#sec-object-types-params

import { monkeyPatch, hashCode } from './tools/standalone.js'

export { monkeyPatch }

/**
 *
 * @example
 * ```js
 * var req = {
 *     "bodySize": 0,
 *     "method": "GET",
 *     "url": "http://127.0.0.1:8080/locales/en/translation.json",
 *     "httpVersion": "HTTP/1.1",
 *     "headers": [
 *       {
 *         "name": "Host",
 *         "value": "127.0.0.1:8080"
 *       },
 *       {
 *         "name": "User-Agent",
 *         "value": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0"
 *       },
 *       {
 *         "name": "Accept-Language",
 *         "value": "en-US,en;q=0.5"
 *       },
 *       {
 *         "name": "Accept-Encoding",
 *         "value": "gzip, deflate, br, zstd"
 *       },
 *       {
 *         "name": "Referer",
 *         "value": "http://127.0.0.1:8080/"
 *       },
 *       {
 *         "name": "Sec-GPC",
 *         "value": "1"
 *       },
 *       {
 *         "name": "Connection",
 *         "value": "keep-alive"
 *       },
 *       {
 *         "name": "Sec-Fetch-Dest",
 *         "value": "empty"
 *       },
 *       {
 *         "name": "Sec-Fetch-Mode",
 *         "value": "cors"
 *       },
 *       {
 *         "name": "Sec-Fetch-Site",
 *         "value": "same-origin"
 *       },
 *       {
 *         "name": "Priority",
 *         "value": "u=4"
 *       },
 *       {
 *         "name": "Pragma",
 *         "value": "no-cache"
 *       },
 *       {
 *         "name": "Cache-Control",
 *         "value": "no-cache"
 *       }
 *     ],
 *     "cookies": [],
 *     "queryString": [],
 *     "headersSize": 454
 *    }
 *    console.log("requestId:",convertOfflineRequestToIdDefault(req))
 *    ```
 */
export function convertOfflineRequestToIdDefault(request) {
    if (!request) {
        return null
    }
    return hashCode(
        JSON.stringify({url: request.url, method: request.method, postData: { encoding: request.postData?.encoding, text: request.postData?.text,}})
    )
}

export function fetchArgsToRequestObject(urlOrRequest, options=undefined, {windowLocationHref=globalThis.window?.location?.href}={}) {
    // standardize format of first argument
    if (typeof urlOrRequest == 'string') {
        try {
            urlOrRequest = new URL(urlOrRequest).href
        } catch (error) {
            if (windowLocationHref) {
                if (urlOrRequest.startsWith("/")) {
                    urlOrRequest = new URL(`${windowLocationHref}/${urlOrRequest}`)
                }
            }
        }
        if (typeof urlOrRequest == 'string') {
            urlOrRequest = new URL(urlOrRequest)
        }
    }

    // turn all of it into a Request object
    let request
    if (options) {
        // options for Request:
        // method,
        // headers,
        // body,
        // referrer,
        // referrerPolicy,
        // mode,
        // credentials,
        // cache,
        // redirect,
        // integrity,
        // keepalive,
        // signal,
        // window,
        // duplex,
        // priority,
        request = new Request(urlOrRequest, options)
    } else if (urlOrRequest instanceof Request) {
        request = urlOrRequest
    } else if (urlOrRequest instanceof URL) {
        request = new Request(urlOrRequest)
    // invalid argument
    } else {
        // e.g. throw error because its an invalid argument (but use the real fetch to trigger the error)
        return fetch(urlOrRequest)
    }

    return request
}

export function convertRequestObjToIdDefault(requestObject) {
    // const { credentials, headers, referrer, method, mode, body, redirect } = options
    let postData = { encoding: undefined, text: undefined }
    if (requestObject.method === 'POST') {
        var requestCopy = requestObject.clone()
        try {
            postData.text = requestCopy.text()
        } catch (error) {
            // TODO: check me, this could be a source of edgecase problems (the btoa() call)
            postData.text = btoa( requestCopy.bytes() )
            postData.encoding = "base64"
        }
    }
    return hashCode(
        JSON.stringify({url: requestObject.url, method: requestObject.method, postData})
    )
}

export function responseJsonToResponseObjectDefault(jsonObj) {
    const headers = new Headers()
    for (const { name, value } of jsonObj.headers) {
        headers.append(name, value)
    }
    if (jsonObj.content?.mimeType) {
        headers.set("Content-Type", jsonObj.content.mimeType)
    }
    let body = ""
    if (jsonObj.content?.text) {
        body = jsonObj.content.text
        if (jsonObj.content?.encoding === "base64") {
            // TODO: check me, this could be a source of edgecase problems
            body = atob(body)
        }
    }

    return new Response(body, {
        status: jsonObj.status,
        statusText: jsonObj.statusText,
        headers: headers,
    })
}

/**
 * createFetchShim
 *
 * @example
 * ```js
 * import lesspassHarString from "./test_data/lesspass.har.binaryified.js"
 * const harData = JSON.parse(lesspassHarString)
 * const fetch = createFetchShim(harData)
 * let res = await fetch("http://127.0.0.1:8080/locales/en/translation.json")
 * console.log("expect a 404: ", await res.text())
 * ```
 */
const globalFetch = globalThis.fetch
export function createFetchShim(
    harData,
    {
        convertOfflineRequestToId=convertOfflineRequestToIdDefault,
        convertRequestObjToId=convertRequestObjToIdDefault,
        convertOfflineDataToResponseObject=responseJsonToResponseObjectDefault,
        hookForNonMatchingRequests=({ realRequestObject, requestId, idToResponseTable, idToOfflineRequestTable, urlToIds }) => {},
        ignoreRequestIdCollisions=false,
        fetch=globalFetch,
    }={}
) {
    const allReqestIds = new Set()
    
    // 
    // build up (effectively) a hashmap of offline requests
    // 
    const idToResponse = {}
    const idToRequest = {}
    for (const {request: requestJson, response: responseJson} of harData.log.entries) {
        if (!requestJson) {
            continue
        }
        const requestId = String(convertOfflineRequestToId(requestJson))
        allReqestIds.add(requestId)
        if (!ignoreRequestIdCollisions && idToRequest[requestId]) {
            console.warn(`Two different requests have the same requestId`, "\nprevious one was:", JSON.stringify(idToRequest[requestId]), "next one is:", JSON.stringify(requestJson), `\n\nThis means you need to give a better \`convertOfflineRequestToId\` argument to the createFetchShim() function like this:\n    createFetchShim(harData, { convertOfflineRequestToId: (req)=>JSON.stringify({url: req.url, method: req.method, }) })`)
        }
        idToRequest[requestId] = requestJson
        idToResponse[requestId] = ()=>convertOfflineDataToResponseObject(responseJson)
    }
    const outerFetch = fetch
    return function fetch(url, options) {
        const requestObject = fetchArgsToRequestObject(url, options)
        // e.g. url, method, postData
        const requestId = convertRequestObjToId(requestObject, url, options)
        if (!allReqestIds.has(requestId)) {
            var output = hookForNonMatchingRequests({
                realRequestObject: requestObject,
                requestId,
                idToResponseTable: idToResponse,
                idToOfflineRequestTable: idToRequest,
                urlToIds: (url)=>Object.entries(idToRequest).filter(([id, request])=>request.url == url).map(([id])=>id),
            })
            if (output) {
                return output
            }
            return outerFetch(url, options)
        }
        return Promise.resolve(idToResponse[requestId]())
    }
}