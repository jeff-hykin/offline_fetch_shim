/**
 * patch a method, without breaking "this" behavior, similar to a decorator
 *
 * @example
 * ```js
 * // Example:
 * const obj = {
 *     thisName: 'Bob',
 *     greet(name) {
 *         return `Hello, ${name}!\n - from: ${this.thisName}`;
 *     }
 * };
 *
 * // Wrap the greet function to log the greeting before returning it
 * monkeyPatch(obj, 'greet', (originalGreet) => {
 *     return function(...args) {
 *         console.log(`Calling greet with args: ${args}`);
 *         const result = originalGreet(...args);
 *         console.log(`Result: ${result}`);
 *         return result;
 *     };
 * });
 *
 * // After patching, the greet method logs the arguments and result
 * obj.greet('Alice');
 * // Console:
 * // Calling greet with args: [ 'Alice' ]
 * // Result: Hello, Alice!
 * // - from: Bob
 * ```
 * @param {Object} object - The object whose method is to be patched.
 * @param {string} attrName - The name of the method to patch.
 * @param {Function} createNewFunction - A function that takes the original function and 
 *                                       returns a new function that will replace the original.
 * @throws {Error} If the specified method does not exist in the object or its prototype chain.
 * 
 */
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
    const wrappedOriginal = function (...args) {
        return originalFunction.apply(theThis, args)
    }
    const innerReplacement = createNewFunction(wrappedOriginal)
    object[attrName] = function (...args) {
        theThis = this
        return innerReplacement.apply(this, args)
    }
}

/**
 * Generates a 32-bit integer hash code for a given string.
 *
 * @param {string} str - The input string to hash.
 * @returns {number} The resulting 32-bit integer hash code.
 * @example
 * ```js
 * const hash = hashCode('hello');
 * console.log(hash); // Output: 3221225473
 * ```
 */
export function hashCode(str) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        let chr = str.charCodeAt(i);
        hash = (hash << 5) - hash + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

/**
 * Serializes the body of a Request clone and returns an object with body and bodyType.
 * 
 * @param {Request} clone - A clone of the original Request.
 * @returns {Promise<{body: any, bodyType: "json"|"text"|"urlencoded"|"multipart"|"binary"}>} 
 *   A promise that resolves to an object containing the parsed body and a string indicating the body type.
 *   Possible values for `bodyType` are:
 *     - "json": for JSON payloads (application/json)
 *     - "text": for plain text or other text-based types (text/*)
 *     - "urlencoded": for URL-encoded form data (application/x-www-form-urlencoded)
 *     - "multipart": for multipart form data (multipart/form-data)
 *     - "binary": for all other types, returned as Uint8Array
 */
export async function serializeBody(clone) {
    const contentType = clone.headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
        const json = await clone.json()
        return { body: json, bodyType: "json" }
    } else if (contentType.includes("text/")) {
        const text = await clone.text()
        return { body: text, bodyType: "text" }
    } else if (contentType.includes("form-urlencoded")) {
        const text = await clone.text()
        return { body: text, bodyType: "urlencoded" }
    } else if (contentType.includes("multipart/form-data")) {
        const formData = await clone.formData()
        const formObj = {}
        for (const [key, value] of formData.entries()) {
            if (value instanceof File) {
                formObj[key] = {
                    name: value.name,
                    type: value.type,
                    size: value.size,
                    lastModified: value.lastModified,
                    data: new Uint8Array(await value.arrayBuffer()),
                }
            } else {
                formObj[key] = value
            }
        }
        return { body: formObj, bodyType: "multipart" }
    } else {
        const buffer = new Uint8Array(await clone.arrayBuffer())
        return { body: buffer, bodyType: "binary" }
    }
}

/**
 * Serializes a Fetch API Request object into a plain JavaScript object,
 * including method, URL, headers, and body (if present and serializable).
 * Handles various body types such as JSON, text, URL-encoded, multipart/form-data, and binary.
 *
 * @async
 * @param {Request} request - The Fetch API Request object to serialize.
 * @returns {Promise<SerializedRequest>} A promise that resolves to a plain object representing the serialized request.
 *
 * @typedef {Object} SerializedRequest
 * @property {string} method
 * @property {string} url
 * @property {Object.<string, string>} headers
 * @property {*} [body]
 * @property {"json"|"text"|"urlencoded"|"multipart"|"binary"|"unserializable"} [bodyType]
 * @property {"omit"|"same-origin"|"include"} [credentials]
 * @property {"default"|"no-store"|"reload"|"no-cache"|"force-cache"|"only-if-cached"} [cache]
 * @property {"cors"|"no-cors"|"same-origin"|"navigate"} [mode]
 * @property {"follow"|"error"|"manual"} [redirect]
 * @property {string} [referrer]
 * @property {string} [referrerPolicy]
 * @property {string} [integrity]
 * @property {boolean} [keepalive]
 * @property {undefined} [signal]
 *
 * @example
 * ```js
 * const serialized = await requestToObject(new Request('/api', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) }));
 * console.log(serialized);
 * ```
 */
export async function requestToObject(request) {
    const serialized = {
        method: request.method,
        url: request.url,
        headers: {},
        body: undefined,
        bodyType: undefined,
        credentials: request.credentials,
        cache: request.cache,
        mode: request.mode,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        integrity: request.integrity,
        keepalive: request.keepalive,
        signal: undefined, // signal is not serializable
    }

    // Serialize headers
    for (const [key, value] of request.headers.entries()) {
        serialized.headers[key] = value
    }

    // Serialize body if present and allowed
    if (request.method !== "GET" && request.method !== "HEAD") {
        try {
            const clone = request.clone()
            const { body, bodyType } = await serializeBody(clone)
            serialized.body = body
            serialized.bodyType = bodyType
        } catch (e) {
            console.warn("Failed to serialize request body:", e)
            serialized.body = undefined
            serialized.bodyType = "unserializable"
        }
    }

    return serialized
}

/**
 * Converts a plain object describing a request into a native `Request` object.
 *
 * @param {Object} obj - The request configuration object.
 * @param {string} obj.method - The HTTP method (e.g., 'GET', 'POST').
 * @param {string} obj.url - The request URL.
 * @param {Object|Headers} [obj.headers] - Request headers.
 * @param {*} [obj.body] - The request body, type depends on `bodyType`.
 * @param {'json'|'text'|'urlencoded'|'binary'|'multipart'} [obj.bodyType] - The type of the body.
 * @param {'omit'|'same-origin'|'include'} [obj.credentials] - Request credentials mode.
 * @param {'default'|'no-store'|'reload'|'no-cache'|'force-cache'|'only-if-cached'} [obj.cache] - Cache mode.
 * @param {'cors'|'no-cors'|'same-origin'|'navigate'} [obj.mode] - Request mode.
 * @param {'follow'|'error'|'manual'} [obj.redirect] - Redirect mode.
 * @param {string} [obj.referrer] - Referrer URL.
 * @param {string} [obj.referrerPolicy] - Referrer policy.
 * @param {string} [obj.integrity] - Subresource integrity value.
 * @param {boolean} [obj.keepalive] - Whether the request can outlive the page.
 * @returns {Request} A native `Request` object constructed from the provided configuration.
 */
export function objectToRequest(obj) {
    const { method, url, headers, body, bodyType, credentials, cache, mode, redirect, referrer, referrerPolicy, integrity, keepalive } = obj

    let finalBody = undefined

    if (body !== undefined) {
        switch (bodyType) {
            case "json":
                finalBody = JSON.stringify(body)
                break
            case "text":
            case "urlencoded":
                finalBody = body
                break
            case "binary":
                finalBody = new Uint8Array(body).buffer
                break
            case "multipart":
                const formData = new FormData()
                for (const key in body) {
                    const val = body[key]
                    if (val && typeof val === "object" && "data" in val) {
                        const blob = new Blob([new Uint8Array(val.data)], { type: val.type })
                        const file = new File([blob], val.name, {
                            type: val.type,
                            lastModified: val.lastModified,
                        })
                        formData.append(key, file)
                    } else {
                        formData.append(key, val)
                    }
                }
                finalBody = formData
                break
            default:
                // Leave undefined for unsupported/unserializable types
                break
        }
    }

    return new Request(url, {
        method,
        headers,
        body: finalBody,
        credentials,
        cache,
        mode,
        redirect,
        referrer,
        referrerPolicy,
        integrity,
        keepalive,
    })
}

/**
 * Wraps a Fetch API Response object to record its properties and body consumption.
 * 
 * This function monkey-patches a response's body-reading methods (such as `text`, `json`, `blob`, `arrayBuffer`, `formData`)
 * to capture and store their results in a `recordedData` object. It also patches the response's body stream to record
 * all chunks read from it. The recorded data includes status, headers, URL, and all body representations accessed.
 * 
 * @param {Response} response - The Fetch API Response object to wrap and record.
 * @returns {[Response, Object]} A tuple containing the original response (with patched methods) and a `recordedData` object
 *   with the following properties:
 *   - {number} status - The HTTP status code.
 *   - {string} statusText - The HTTP status text.
 *   - {Object} headers - Plain object of response headers.
 *   - {string} url - The response URL.
 *   - {boolean} redirected - Whether the response was the result of a redirect.
 *   - {string} type - The response type.
 *   - {boolean} ok - Whether the response was successful (status in the range 200-299).
 *   - {boolean} bodyUsed - Whether the body has been consumed.
 *   - {Promise|undefined} trailer - The response trailer, if supported.
 *   - {any} json - The parsed JSON body, if accessed.
 *   - {string|null} text - The text body, if accessed.
 *   - {Blob|null} blob - The Blob body, if accessed.
 *   - {ArrayBuffer|null} arrayBuffer - The ArrayBuffer body, if accessed.
 *   - {Object|null} formData - The FormData body as a plain object, if accessed.
 *   - {Array<Uint8Array>} streamChunks - Array of Uint8Array chunks read from the body stream.
 */
export function wrapAndRecordResponse(response) {
    // Serialize headers to a plain object
    const headersObj = {}
    for (const [key, value] of response.headers.entries()) {
        headersObj[key] = value
    }

    const recordedData = {
        status: response.status,
        statusText: response.statusText,
        headers: headersObj,
        url: response.url,
        redirected: response.redirected,
        type: response.type,
        ok: response.ok,
        bodyUsed: false,
        // Not all environments support these, so check existence
        trailer: typeof response.trailer !== "undefined" ? response.trailer : undefined,
        json: null,
        text: null,
        blob: null,
        arrayBuffer: null,
        formData: null,
        streamChunks: [],
    }

    // immutable returns
    for (const method of ['text', 'blob',]) {
        monkeyPatch(response, method, (originalMethod) => () => originalMethod().then((data) => {
            return recordedData[method] = data
        }))
    }
    monkeyPatch(response, 'json', (originalMethod) => () => originalMethod().then((data) => {
        recordedData.json = structuredClone(data)
        return data
    }))
    monkeyPatch(response, 'arrayBuffer', (originalMethod) => () => originalMethod().then((data) => {
        recordedData.arrayBuffer = data.slice(0) // clone
        return data
    }))
    monkeyPatch(response, 'formData', (originalMethod) => () => originalMethod().then((data) => {
        recordedData.formData = {}
        for (const [key, value] of data.entries()) {
            recordedData.formData[key] = value
        }
        return data
    }))

    // stream
    let streamIndex = 0
    const recordedChunks = recordedData.streamChunks
    function patchStream(originalStream) {
        // patch getReader
        monkeyPatch(originalStream, 'getReader', (originalGetReader) => {
            let reader
            let localIndex = -1
            const proxyReader = {
                async read() {
                    localIndex++
                    const { done, value } = await reader.read()
                    if (!done && value) {
                        if (localIndex > streamIndex) {
                            streamIndex = localIndex
                            recordedChunks.push(value.slice(0)) // clone chunk
                        }
                    }
                    return { done, value }
                },
                releaseLock() {
                    return reader.releaseLock()
                },
                cancel(reason) {
                    return reader.cancel(reason)
                },
            }
            return () => {
                reader = originalGetReader()
                return proxyReader
            }
        })
        // patch tee
        monkeyPatch(response.body, 'tee', (originalTee) => () => {
            const [stream1, stream2] = originalTee()
            patchStream(stream1)
            patchStream(stream2)
            return [stream1, stream2]
        })
    }
    patchStream(response.body)

    return [response, recordedData]
}

/**
 * Creates a native Response object from a RecordedResponseMeta object.
 * Only one of json, text, blob, arrayBuffer, formData, or streamChunks will be used as the body,
 * in the following priority: arrayBuffer > blob > json > text > formData > streamChunks.
 *
 * @param {Object} meta - The RecordedResponseMeta object.
 * @param {number} meta.status
 * @param {string} meta.statusText
 * @param {Object.<string, string>} meta.headers
 * @param {string} meta.url
 * @param {boolean} meta.redirected
 * @param {string} meta.type
 * @param {boolean} meta.ok
 * @param {boolean} meta.bodyUsed
 * @param {Promise<Headers>|undefined} [meta.trailer]
 * @param {any|null} meta.json
 * @param {string|null} meta.text
 * @param {Blob|null} meta.blob
 * @param {ArrayBuffer|null} meta.arrayBuffer
 * @param {Object|null} meta.formData
 * @param {Array<Uint8Array>} meta.streamChunks
 * @returns {Response}
 */
export function responseDataToResponse(meta) {
    let body = undefined

    if (meta.arrayBuffer) {
        body = meta.arrayBuffer
    } else if (meta.blob) {
        body = meta.blob
    } else if (meta.json !== null && meta.json !== undefined) {
        body = JSON.stringify(meta.json)
        if (!meta.headers['content-type']) {
            meta.headers['content-type'] = 'application/json'
        }
    } else if (meta.text !== null && meta.text !== undefined) {
        body = meta.text
    } else if (meta.formData) {
        const formData = new FormData()
        for (const key in meta.formData) {
            formData.append(key, meta.formData[key])
        }
        body = formData
    } else if (meta.streamChunks && meta.streamChunks.length > 0) {
        // Combine Uint8Array chunks into a Blob
        body = new Blob(meta.streamChunks)
    }

    return new Response(body, {
        status: meta.status,
        statusText: meta.statusText,
        headers: meta.headers,
    })
}