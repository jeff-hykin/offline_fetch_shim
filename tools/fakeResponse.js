import { typedArrayClasses } from 'https://esm.sh/gh/jeff-hykin/good-js@1.18.2.0/source/flattened/typed_array_classes.js'
import { isPureObject } from 'https://esm.sh/gh/jeff-hykin/good-js@1.18.2.0/source/flattened/is_pure_object.js'

export function fakeResponse(data, { status=200, statusText="OK", headers={}, ...other }) {
    let body = undefined

    if (data instanceof ArrayBuffer) {
        body = data
    } else if (typedArrayClasses.some(cls=>data instanceof cls)) {
        body = data.buffer
    } else if (typeof data === 'string' || data instanceof FormData || data instanceof Blob) {
        body = data
    } else if (isPureObject(data) || data instanceof Array) {
        body = JSON.stringify(data)
        if (!meta.headers['content-type']) {
            meta.headers['content-type'] = 'application/json'
        }
    }

    return new Response(body, {
        status: meta.status,
        statusText: meta.statusText,
        headers: meta.headers,
        ...other,
    })
}