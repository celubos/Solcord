// SPDX-License-Identifier: Apache-2.0

export interface ReleaseArtifactRecord {
    name: string;
    category: string;
    bytes: number;
    sha256: string;
}

export interface ReleaseCommonOptions {
    repo?: string;
    sourceCommit: string;
    candidateLabel: string;
}

export interface AssembleReleaseOptions extends ReleaseCommonOptions {
    installerBundle: string;
    installerReceiptSha256: string;
    evidenceManifest: string;
    evidenceManifestSha256: string;
    output: string;
}

export interface ValidateReleaseOptions extends ReleaseCommonOptions {
    releaseDirectory: string;
    releaseManifestSha256: string;
}

export interface AssembleReleaseResult {
    output: string;
    sourceCommit: string;
    candidateLabel: string;
    manifestSha256: string;
    artifacts: ReleaseArtifactRecord[];
}

export interface ValidateReleaseResult {
    releaseDirectory: string;
    sourceCommit: string;
    candidateLabel: string;
    manifestSha256: string;
    artifactCount: number;
}

export function assembleRelease(options: AssembleReleaseOptions): AssembleReleaseResult;
export function validateRelease(options: ValidateReleaseOptions): ValidateReleaseResult;
export function createDeterministicSourceArchive(repo: string, sourceCommit: string, prefix: string, destination: string): void;
