/** Exact public-signature comparison. Changed signatures always require review, even when probably additive. */
export function comparePublicApi(previous, current) {
  const report = { addedExports: [], removedExports: [], changedSignatures: [], addedAssets: [], removedAssets: [], changedAssets: [] };
  for (const entry of new Set([...Object.keys(previous.exports ?? {}), ...Object.keys(current.exports ?? {})])) {
    const before = previous.exports?.[entry] ?? {}, after = current.exports?.[entry] ?? {};
    for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const item = { entry, name };
      if (!Object.hasOwn(before, name)) report.addedExports.push(item);
      else if (!Object.hasOwn(after, name)) report.removedExports.push(item);
      else if (before[name] !== after[name]) report.changedSignatures.push(item);
    }
  }
  for (const asset of new Set([...Object.keys(previous.assets ?? {}), ...Object.keys(current.assets ?? {})])) {
    if (!Object.hasOwn(previous.assets ?? {}, asset)) report.addedAssets.push(asset);
    else if (!Object.hasOwn(current.assets ?? {}, asset)) report.removedAssets.push(asset);
    else if (previous.assets[asset] !== current.assets[asset]) report.changedAssets.push(asset);
  }
  return report;
}
