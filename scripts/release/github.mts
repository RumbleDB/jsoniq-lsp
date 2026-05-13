import fs from "node:fs";
import path from "node:path";

import { Octokit } from "@octokit/rest";

type PackageJson = {
    name: string;
    version: string;
};

type Release = Awaited<ReturnType<typeof octokit.rest.repos.createRelease>>["data"];
type ReleaseAsset = Release["assets"][number];

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
    const response = await octokit.rest.repos.getReleaseByTag({
        owner,
        repo,
        tag,
    });
    if (response.status === 200) {
        return response.data;
    } else if (response.status === 404) {
        return null;
    } else {
        throw new Error(
            `Unexpected response status ${response.status} when fetching release with tag '${tag}'.`,
        );
    }
}

export async function ensureRelease(tag: string, name: string): Promise<Release> {
    const existingRelease = await getRelease(tag);

    if (existingRelease !== null) {
        return existingRelease;
    }

    const response = await octokit.rest.repos.createRelease({
        owner,
        repo,
        tag_name: tag,
        name,
        generate_release_notes: true,
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
