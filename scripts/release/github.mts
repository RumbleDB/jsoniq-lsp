import fs from "node:fs";
import path from "node:path";

import { Octokit } from "@octokit/rest";

type PackageJson = {
    name: string;
    version: string;
};

export type Release = Awaited<ReturnType<typeof octokit.rest.repos.createRelease>>["data"];
export type ReleaseAsset = Release["assets"][number];

const githubToken = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (githubToken === undefined || repository === undefined) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required.");
}

const [owner, repo] = repository.split("/");

if (owner === undefined || repo === undefined) {
    throw new Error(`GITHUB_REPOSITORY must be in 'owner/repo' format, got '${repository}'.`);
}

const octokit = new Octokit({
    auth: githubToken,
});

export function releaseTag(packageJson: PackageJson): string {
    return `${packageJson.name}@${packageJson.version}`;
}

export async function getRelease(tag: string): Promise<Release | null> {
    try {
        const response = await octokit.rest.repos.getReleaseByTag({
            owner,
            repo,
            tag,
        });

        return response.data;
    } catch {
        return null;
    }
}

export async function ensureRelease(
    tag: string,
    name: string,
    options: { body?: string; prerelease?: boolean } = {},
): Promise<Release> {
    const existingRelease = await getRelease(tag);

    if (existingRelease !== null) {
        return existingRelease;
    }

    const response = await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name,
        body: options.body,
        generate_release_notes: options.body === undefined,
        prerelease: options.prerelease ?? false,
    });

    return response.data;
}

export async function uploadReleaseAsset(release: Release, file: string): Promise<ReleaseAsset> {
    const assetName = path.basename(file);
    const existingAsset = release.assets.find((asset) => asset.name === assetName);

    if (existingAsset !== undefined) {
        await octokit.rest.repos.deleteReleaseAsset({
            owner,
            repo,
            asset_id: existingAsset.id,
        });
    }

    const data = fs.readFileSync(file);

    const response = await octokit.rest.repos.uploadReleaseAsset({
        owner,
        repo,
        release_id: release.id,
        name: assetName,
        data: data as unknown as string,
        headers: {
            "content-length": data.byteLength,
            "content-type": "application/octet-stream",
        },
    });

    return response.data;
}

export async function downloadReleaseAssetText(asset: ReleaseAsset): Promise<string> {
    const response = await fetch(asset.url, {
        headers: {
            authorization: `Bearer ${githubToken}`,
            accept: "application/octet-stream",
        },
    });

    if (!response.ok) {
        throw new Error(
            `Failed to download release asset '${asset.name}': HTTP ${response.status} ${response.statusText}`,
        );
    }

    return await response.text();
}
