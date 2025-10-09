import { hashCode, requestToObject, responseDataToResponse } from './tools/standalone.js'
import { toRepresentation } from './tools/generic.js'

const realFetch = globalThis.fetch

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
        allRequestIds.add(requestId)
        if (!ignoreRequestIdCollisions && idToRequest[requestId]) {
            console.warn(`Two different requests have the same requestId`, "\nprevious one was:", baseToRepresentation(idToRequest[requestId]), "next one is:", baseToRepresentation(requestData), `\n\nThis means you need to give a better \`convertOfflineRequestToId\` argument to the createFetchShim() function like this:\n    createFetchShim({...data, requestDataToIdFunc: (req, { hashString, serialize })=>\`\${req.url}:\${req.method}\`})\n\n`)
        }
        idToRequest[requestId] = requestData
        idToResponseGetters[requestId] = ()=>responseDataToResponse(idToResponseData[requestId])
    }
    const outerFetch = fetch
    return function fetch(resource, options) {
        const request = new Request(resource, options)
        const requestData = requestToObject(request)
        // e.g. resource, method, postData
        const requestId = requestDataToIdFunc(requestData, { hashString, serialize, originalArgs: [resource, options]})
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