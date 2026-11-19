// Shared barrel (native and web). Metro resolves `./createAudioRoute` to the `.web.ts` twin (a fake) on web; only
// names that both twins export may be re-exported from it.
export { createAudioRoute } from './createAudioRoute';
export {
  captureConstraintsDiffer,
  clampTunables,
  describeTunables,
  toGetUserMediaConstraints,
} from './tunables';
