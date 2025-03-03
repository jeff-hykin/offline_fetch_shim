// based on:
    // (yeah it says "dont use" but whatever)
    // https://w3c.github.io/web-performance/specs/HAR/Overview.html#sec-object-types-params

export function monkeyPatch(object, attrName, createNewFunction) {
    let prevObj = null
    while (!Object.getOwnPropertyNames(object).includes(attrName)) {
        prevObj = object
        object = Object.getPrototypeOf(object)
        if (prevObj === object) {
            throw new Error(`Could not find ${attrName} on ${object}`)
        }
    }
    const originalFunction = object[attrName]
    let theThis
    const wrappedOriginal = function(...args) {
        return originalFunction.apply(theThis, args)
    }
    const innerReplacement = createNewFunction(wrappedOriginal)
    object[attrName] = function(...args) {
        theThis = this
        return innerReplacement.apply(this, args)
    }
}

export function hashCode(str) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

export function convertOfflineRequestToId(request) {
    if (!request) {
        return null
    }
    return hashCode(JSON.stringify({url: request.url, method: request.method, postData: { encoding: request.postData?.encoding, text: request.postData?.text,}}))
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

export function convertRequestObjToId(requestObject) {
    // 
    // extract url and params
    // 
    const url = requestObject.url

    // 
    // extract method
    // 
    const method = requestObject.method

    // const { credentials, headers, referrer, method, mode, body, redirect } = options
    let postData = { encoding: undefined, text: undefined }
    if (method === 'POST') {
        var requestCopy = requestObject.clone()
        try {
            postData.text = requestCopy.text()
        } catch (error) {
            postData.text = btoa( requestCopy.bytes() )
            postData.encoding = "base64"
        }
    }
    return hashCode(
        JSON.stringify({url, method, postData})
    )
}

export function responseJsonToResponseObject(jsonObj) {
    const headers = new Headers()
    for (const { name, value } of jsonObj.headers) {
        headers.append(key, value)
    }
    if (jsonObj.content?.mimeType) {
        headers.set("Content-Type", jsonObj.content.mimeType)
    }
    let body = ""
    if (jsonObj.content?.text) {
        body = jsonObj.content.text
        if (jsonObj.content?.encoding === "base64") {
            body = atob(body)
        }
    }
    
    return new Response(body, {
        status: jsonObj.status,
        statusText: jsonObj.statusText,
        headers: headers,
    })
}

export function createFetchShim(
    harData,
    {
        convertOfflineRequestToId=convertOfflineRequestToId,
        convertRequestObjToId=convertRequestObjToId,
        convertOfflineDataToResponseObject=responseJsonToResponseObject,
        hookForNonMatchingRequests=({ realRequestObject, requestId, idToResponseTable, idToOfflineRequestTable }) => {},
        ignoreRequestIdCollisions=false,
        fetch=globalThis.fetch,
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
            })
            if (output) {
                return output
            }
            return fetch(url, options)
        }
        return Promise.resolve(idToResponse[requestId]())
    }
}