import { requestToObject, objectToRequest } from './standalone.js'
import * as Yaml from './yaml.js'

export async function serializeFetchArgs(resource, options) {
    return yaml.stringify(await requestToObject(new Request(url, options)))
}

export function deserializeFetchArg(dataString) {
    return objectToRequest(yaml.parse(dataString))
}