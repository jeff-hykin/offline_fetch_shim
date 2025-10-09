import { serializeFetchArgs, deserializeFetchArg, } from './tools/generic.js'
import { hashCode, monkeyPatch, requestToObject, objectToRequest, wrapAndRecordResponse, responseDataToResponse } from './tools/standalone.js'
import { toRepresentation } from 'https://esm.sh/gh/jeff-hykin/good-js@1.18.2.0/source/flattened/to_representation.js'

export { monkeyPatch }

const realFetch = globalThis.fetch
const activeRecorders = []
let fetchIndex = 0
export async function shimmedFetch(resource, options) {
    if (activeRecorders.length == 0) {
        return realFetch(resource, options)
    }
    fetchIndex++
    const request = new Request(resource, options)
    const requestObj = requestToObject(request)
    requestObj.fetchIndex = fetchIndex
    Object.freeze(requestObj)
    const recordersToSet = []
    // const serialized = await serializeFetchArgs(resource, options)
    for (const eachRecorder of activeRecorders) {
        const id = eachRecorder.requestDataToIdFunc(requestObj)
        eachRecorder.requestDataToId.set(requestObj, id)
        if (id) {
            if (!eachRecorder.idToResponseData[id]) {
                recordersToSet.push([eachRecorder, id])
            }
        }
    }
    return realFetch(request).then(response => {
        var [ response, recordedData ] = wrapAndRecordResponse(response)
        for (const [recorder, requestId] of recordersToSet) {
            recorder.idToResponseData[requestId] = recordedData
        }
        return response
    })
}

/**
 * Class for recording and replaying fetch requests and responses.
 *
 * @class
 * @example
 * ```javascript
 * const recorder = new FetchRecording()
 * recorder.start()
 * await fetch('https://api.example.com/data')
 * recorder.stop()
 * // globalThis.fetch goes back to its original value (assuming all recorders are stopped)
 * console.log(recorder.getRecording())
 * ```
 *
 * @param {Object} [options] - Configuration options.
 * @param {Function} [options.requestDataToIdFunc] - Function to generate a unique ID for a request, given request data and helpers ({hashString, serialize}).
 *
 * @property
 * 
 */
export class FetchRecording {
    constructor({ requestDataToIdFunc=(reqData, {hashString, serialize})=>hashString(serialize(reqData)) }={}) {
        this.requestDataToId = new Map()
        this.idToResponseData = {}
        this.requestDataToIdFunc = requestDataToIdFunc
    }
    start() {
        if (globalThis.fetch === realFetch) {
            monkeyPatch(globalThis, "fetch", (originalFetch) => shimmedFetch)
        }
        activeRecorders.push(this)
    }
    stop() {
        activeRecorders.splice(activeRecorders.indexOf(this), 1)
        if (activeRecorders.length == 0) {
            globalThis.fetch = realFetch
        }
    }
    getRecording() {
        return toRepresentation({
            requestDataToIdFunc: this.requestDataToIdFunc,
            requestDataToId: this.requestDataToId,
            idToResponseData: this.idToResponseData,
        })
    }
}

let defaultRecorder
export function simpleRecorderStart() {
    if (!defaultRecorder) {
        defaultRecorder = new FetchRecording()
        defaultRecorder.start()
    }
}

function downloadAsJsFile(filename, jsString) {
    const blob = new Blob([jsString], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const a = globalThis.document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.js') ? filename : filename + '.js'
    globalThis.document.body.appendChild(a)
    a.click()
    globalThis.document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
export function simpleRecorderStop() {
    if (defaultRecorder) {
        defaultRecorder.stop()
    }
    const isBrowser = !!globalThis.document
    if (isBrowser) {
        downloadAsJsFile('fetch_recording.js', `export default ${defaultRecorder.getRecording()}`)
    }
    return defaultRecorder.getRecording()
}

/**
 * Creates a fetch shim that intercepts fetch requests and serves offline responses based on a mapping.
 *
 * @param {Object} mappings - The mappings for request/response handling.
 * @param {Function} mappings.requestDataToIdFunc - Function to convert request data to a unique request ID.
 * @param {Map|Object} mappings.requestDataToId - Map or object mapping request data to IDs.
 * @param {Object} mappings.idToResponseData - Object mapping request IDs to response data.
 * @param {Object} [options={}] - Optional configuration.
 * @param {Function} [options.hashString=hashCode] - Function to hash a string.
 * @param {Function} [options.serialize=toRepresentation] - Function to serialize request data.
 * @param {Function} [options.hookForNonMatchingRequests] - Hook called when a request does not match any offline data.
 * @param {boolean} [options.ignoreRequestIdCollisions=false] - If true, ignores request ID collisions.
 * @param {Function} [options.fetch=realFetch] - The real fetch function to use for unmatched requests.
 * @returns {Function} A fetch-like function that serves offline responses when available.
 *
 * @example
 * ```js
 * const dataFromFetchRecording = {
 *   requestDataToIdFunc: (reqData, { hashString, serialize }) => reqData.url + ':' + reqData.method,
 *   requestDataToId: new Map([[{ url: 'https://api.com/data', method: 'GET' }, 'id1']]),
 *   idToResponseData: { id1: { status: 200, body: 'offline data' } }
 * }
 * const shimmedFetch = createFetchShim(dataFromFetchRecording, {fetch});
 * // Now fetch('https://api.com/data') will return the offline response.
 * ```
 */
export function createFetchShim(
    { requestDataToIdFunc, requestDataToId, idToResponseData },
    {
        hashString=hashCode,
        serialize=toRepresentation,
        hookForNonMatchingRequests=({ realRequestObject, requestData, requestId, idToResponseTable, idToOfflineRequestTable, urlToIds }) => {},
        ignoreRequestIdCollisions=false,
        fetch=realFetch,
    }={}
) {
    const allRequestIds = new Set()
    
    // 
    // build up (effectively) a hashmap of offline requests
    // 
    const idToRequest = {}
    const idToResponseGetters = {}
    for (const [requestData, id] of requestDataToId.entries()) {
        const requestId = String(requestDataToIdFunc(requestData, { hashString, serialize }))
        idToRequest[requestId] = requestData
        allRequestIds.add(requestId)
        if (!ignoreRequestIdCollisions && idToRequest[requestId]) {
            console.warn(`Two different requests have the same requestId`, "\nprevious one was:", JSON.stringify(idToRequest[requestId]), "next one is:", JSON.stringify(requestJson), `\n\nThis means you need to give a better \`convertOfflineRequestToId\` argument to the createFetchShim() function like this:\n    createFetchShim(harData, { convertOfflineRequestToId: (req)=>JSON.stringify({url: req.url, method: req.method, }) })`)
        }
        idToRequest[requestId] = requestJson
        idToResponseGetters[requestId] = ()=>responseDataToResponse(idToResponseData[requestId])
    }
    const outerFetch = fetch
    return function fetch(resource, options) {
        const request = new Request(resource, options)
        const requestData = requestToObject(request)
        // e.g. resource, method, postData
        const requestId = convertRequestDataToIdFunc(requestData, resource, options)
        if (!allRequestIds.has(requestId)) {
            var output = hookForNonMatchingRequests({
                realRequestObject: request,
                requestData,
                requestId,
                idToResponseTable: idToResponseGetters,
                idToOfflineRequestTable: idToRequest,
                urlToIds: (url)=>Object.entries(idToRequest).filter(([id, request])=>request.url == url).map(([id])=>id),
            })
            if (output) {
                return output
            }
            return outerFetch(resource, options)
        }
        return Promise.resolve(idToResponseGetters[requestId]())
    }
}