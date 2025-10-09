import { FetchRecording } from "./recorder.js";
const recorder = new FetchRecording()
recorder.start()
export function getData() {
    return recorder.getRecording()
}
export function printData() {
    console.log(recorder.getRecording())
}
