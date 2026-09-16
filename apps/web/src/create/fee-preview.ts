/** Display-only percentages from MarketFeeAccounting and ProtocolFeeVaultLiabilities.
 * Creator tax is excluded: the contract credits it entirely to the creator.
 */
export function feePreviewRows(holderSharing: boolean, stakingEnabled = true) {
  return [
    { stage: 'Growing', activeStake: false },
    { stage: stakingEnabled ? 'Bloomed · no active stake' : 'Bloomed', activeStake: false },
    { stage: 'Bloomed · active stake', activeStake: true },
  ].filter(row => stakingEnabled || !row.activeStake).map(({ stage, activeStake }) => {
    const stakers = activeStake ? 30 : 0;
    const creatorBase = 100 - 30 - stakers;
    const holders = holderSharing ? creatorBase / 2 : 0;
    return { stage, activeStake, creator: creatorBase - holders, holders, stakers, platform: 30 };
  });
}

export function feePreviewTable(holderSharing: boolean, stakingEnabled: boolean): string {
  const columns = [
    { key: 'creator', label: 'You' },
    ...(holderSharing ? [{ key: 'holders', label: 'Holders' }] : []),
    ...(stakingEnabled ? [{ key: 'stakers', label: 'Stakers' }] : []),
    { key: 'platform', label: 'Platform' },
  ] as const;
  return `<h3>Current fee split</h3><table>
    <caption class="fee-table-caption">Base fee distribution for your current settings</caption>
    <thead><tr><th scope="col">Stage</th>${columns.map(col => `<th scope="col">${col.label}</th>`).join('')}</tr></thead>
    <tbody>${feePreviewRows(holderSharing, stakingEnabled).map(row => `<tr><th scope="row">${row.stage}</th>${columns.map(col => `<td${col.key === 'creator' ? ' class="creator-fee-share"' : ''}>${row[col.key as 'creator' | 'holders' | 'stakers' | 'platform']}%</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}
