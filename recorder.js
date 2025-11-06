// import { serializeFetchArgs, deserializeFetchArg, } from './tools/generic.js'
import { hashCode, monkeyPatch, requestToObject, objectToRequest, wrapAndRecordResponse, responseDataToResponse } from './tools/standalone.js'
import { toRepresentation } from './tools/generic.js'
import { createFetchShim } from './replay.js'

export { monkeyPatch, createFetchShim }

const realFetch = globalThis.fetch
const activeRecorders = []
let fetchIndex = 0
export async function shimmedFetch(resource, options) {
    if (activeRecorders.length == 0) {
        return realFetch(resource, options)
    }
    fetchIndex++
    const request = new Request(resource, options)
    const requestObj = await requestToObject(request)
    requestObj.fetchIndex = fetchIndex
    Object.freeze(requestObj)
    const recordersToSet = []
    // const serialized = await serializeFetchArgs(resource, options)
    for (const eachRecorder of activeRecorders) {
        const id = await eachRecorder.requestDataToIdFunc(requestObj, {hashString:eachRecorder.hashString, serialize:eachRecorder.serialize})
        eachRecorder.requestDataToId.set(requestObj, id)
        let index = -1
        for (const [key, value] of eachRecorder.requestDataToId.entries()) {
            index++
            if (key == requestObj) {
                break
            }
        }
        if (id) {
            if (!eachRecorder.requestIndexToResponseData[index]) {
                recordersToSet.push([eachRecorder, id, index])
            }
        }
    }
    return realFetch(resource, options).then(response => {
        var [ response, recordedData] = wrapAndRecordResponse(response)
        for (const [recorder, requestId, index] of recordersToSet) {
            recorder.requestIndexToResponseData[index] = recordedData
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
    constructor({ requestDataToIdFunc=(reqData, {hashString, serialize}={})=>hashString(serialize(reqData)), hashString=hashCode, serialize=toRepresentation } = {}) {
        this.requestDataToId = new Map()
        this.requestIndexToResponseData = {}
        this.requestDataToIdFunc = requestDataToIdFunc
        this.hashString = hashString
        this.serialize = serialize
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
            requestIndexToResponseData: this.requestIndexToResponseData,
        })
    }
}

export let defaultRecorder
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
    const recording = defaultRecorder.getRecording()
    const isBrowser = !!globalThis.document
    if (isBrowser) {
        downloadAsJsFile('fetch_recording.js', `export default ${recording}`)
    }
    defaultRecorder = undefined
    return recording
}