package deployment

// Modes are explicit release identities; runtime code hashes must still be pinned separately.
const LegacyContinuousHolderMode = "TICKERGARDEN_HOLDER_STREAM_24H_V1"
const BatchedContinuousHolderMode = "TICKERGARDEN_HOLDER_BATCHED_24H_V2"
const ConfigurableBatchedContinuousHolderMode = "TICKERGARDEN_HOLDER_CONFIGURABLE_24H_V3"

const DualAssetContinuousHolderMode = "TICKERGARDEN_HOLDER_DUAL_ASSET_24H_V4"

func SupportedContinuousHolderMode(mode string) bool {
	return mode == Hash([]byte(DualAssetContinuousHolderMode)) || mode == Hash([]byte(LegacyContinuousHolderMode)) || mode == Hash([]byte(BatchedContinuousHolderMode)) || mode == Hash([]byte(ConfigurableBatchedContinuousHolderMode))
}
