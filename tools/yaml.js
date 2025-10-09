import { YAMLMap, YAMLSeq, stringify as baseStringify, parse as baseParse, } from 'https://esm.sh/yaml@2.4.3'
import { stringifyString } from 'https://esm.sh/yaml@2.4.3/util'

const customTaggers = []

// const uint8arrayTag = '!js/Uint8Array'
customTaggers.push(
    // Date // builtin to the yaml library so just a string name
    'timestamp',
    // Uint8Array (encoded as string)
    'binary',
    // RegExp
    {
        identify: value => value instanceof RegExp,
        tag: '!js/RegExp',
        resolve(str) {
            const match = str.match(/^\/([\s\S]+)\/([gimuy]*)$/)
            if (!match) throw new Error('Invalid !re value')
            return new RegExp(match[1], match[2])
        }
    },
    // Symbol.for
    {
        identify: value => value?.constructor === Symbol,
        tag: '!js/Symbol',
        resolve: str => Symbol.for(str),
        stringify(item, ctx, onComment, onChompKeep) {
            const key = Symbol.keyFor(item.value)
            if (key === undefined) throw new Error('Only shared symbols are supported')
            return stringifyString({ value: key }, ctx, onComment, onChompKeep)
        }
    },
    // // manual Uint8Array
    // {
    //     collection: 'seq',
    //     tag: uint8arrayTag,
    //     identify: v => v instanceof Uint8Array,
    //     nodeClass: class extends YAMLSeq {
    //         tag = uint8arrayTag
    //         toJSON(_, ctx) {
    //             const array = super.toJSON(_, { ...ctx, seqAsSeq: false }, Object)
    //             return new Uint8Array(array)
    //         }
    //     },
    // },
)

export const stringify = (obj, options) => baseStringify(obj, { defaultStringType: 'QUOTE_DOUBLE', ...options, customTags: [ ...options?.customTags, ...customTaggers ] })
export const parse = (str, options) => baseParse(str, { ...options, customTags: [ ...options?.customTags, ...customTaggers ] })

// const dataString = stringify(
//     {
//         regexp: /foo/gi,
//         symbol: Symbol.for('bar'),
//         nullobj: Object.assign(Object.create(null), { a: 1, b: 2 }),
//         uint8array: new Uint8Array([1, 2, 3]),
//         error: new Error('This was an error')
//     },
//     { customTags: customTaggers }
// )
// console.log(dataString)

// const data = parse(dataString, { schema: 'failsafe', customTags: customTaggers })
// console.debug(`data is:`,data)