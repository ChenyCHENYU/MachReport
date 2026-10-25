export interface PublicApiSnapshot { exports?: Record<string, Record<string, string>>; assets?: Record<string, string> }
export interface PublicApiDifference {
  addedExports: { entry: string; name: string }[];
  removedExports: { entry: string; name: string }[];
  changedSignatures: { entry: string; name: string }[];
  addedAssets: string[]; removedAssets: string[]; changedAssets: string[];
}
export function comparePublicApi(previous: PublicApiSnapshot, current: PublicApiSnapshot): PublicApiDifference;
