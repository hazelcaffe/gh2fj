import type { GithubUser, GithubOrg } from "./types.js";
import axios, { AxiosInstance } from "axios";

export class ForgejoClient {
    private api: AxiosInstance;
    private orgOwner: string;

    constructor(baseURL: string, token: string, orgOwner = "") {
        this.orgOwner = orgOwner;
        this.api = axios.create({
            baseURL: baseURL.endsWith("/") ? `${baseURL}api/v1` : `${baseURL}/api/v1`,
            headers: {
                Authorization: `token ${token}`,
                "Content-Type": "application/json",
            },
        });
    }

    async ensureUser(user: GithubUser): Promise<void> {
        try {
            await this.api.get(`/users/${user.login}`);
            await this.updateUser(user);
            await this.updateAvatar(user.login, user.avatar_url, false);
        } catch (err: any) {
            if (err.response?.status === 404) {
                try {
                    await this.api.post("/admin/users", {
                        email: user.email || `${user.login}@example.com`,
                        username: user.login,
                        password: process.env.DEFAULT_PASSWORD || "ChangeMe123!",
                        must_change_password: false,
                        full_name: user.name || user.login,
                        visibility: "limited",
                    });
                } catch (createErr) {
                    throw this.toError(createErr, `failed to create user ${user.login}`);
                }

                await this.updateUser(user);
                await this.updateAvatar(user.login, user.avatar_url, false);
            } else {
                throw this.toError(err, `failed to ensure user ${user.login}`);
            }
        }
    }

    async ensureOrg(org: GithubOrg): Promise<void> {
        try {
            await this.api.get(`/orgs/${org.login}`);
            await this.updateOrg(org);
            await this.updateAvatar(org.login, org.avatar_url, true);
        } catch (err: any) {
            if (err.response?.status === 404) {
                const endpoint = this.orgOwner ? `/admin/users/${this.orgOwner}/orgs` : "/orgs";
                try {
                    await this.api.post(endpoint, {
                        username: org.login,
                        full_name: org.name || org.login,
                        description: org.description || "",
                        website: this.validUrl(org.websiteUrl),
                        visibility: "private",
                    });
                } catch (createErr) {
                    throw this.toError(createErr, `failed to create org ${org.login}`);
                }

                await this.updateAvatar(org.login, org.avatar_url, true);
            } else {
                throw this.toError(err, `failed to ensure org ${org.login}`);
            }
        }
    }

    async migrateRepo(
        originalUrl: string,
        repoName: string,
        targetOwner: string,
        description: string | null,
        accessToken?: string
    ): Promise<string> {
        try {
            const { data: repo } = await this.api.get(`/repos/${targetOwner}/${repoName}`);


            if (repo.mirror) {
                try {
                    await this.api.post(`/repos/${targetOwner}/${repoName}/mirror-sync`);
                } catch { }
            }

            try {
                await this.api.patch(`/repos/${targetOwner}/${repoName}`, {
                    private: true,
                    description: description || "",
                });

                return "updated_private";
            } catch (err: any) {
                return `error: patch failed: ${this.errorMessage(err)}`;
            }
        } catch (err: any) {
            if (err.response?.status === 404) {
                await this.api.post("/repos/migrate", {
                    clone_addr: originalUrl,
                    mirror: true,
                    repo_name: repoName,
                    repo_owner: targetOwner,
                    description: description || "",
                    private: true,
                    service: "github",
                    auth_token: accessToken || "",
                });

                return "migrated";
            } else {
                return `error: ${this.errorMessage(err)}`;
            }
        }
    }

    private async updateUser(user: GithubUser): Promise<void> {
        try {
            await this.api.patch(`/admin/users/${user.login}`, {
                full_name: user.name || user.login,
                website: this.validUrl(user.websiteUrl),
                location: user.location || "",
                description: user.bio || "",
                visibility: "limited",
            });
        } catch { }
    }

    private async updateOrg(org: GithubOrg): Promise<void> {
        try {
            await this.api.patch(`/orgs/${org.login}`, {
                full_name: org.name || org.login,
                description: org.description || "",
                website: this.validUrl(org.websiteUrl),
                visibility: "private",
            });
        } catch { }
    }

    private async updateAvatar(name: string, avatarUrl: string, isOrg: boolean): Promise<void> {
        if (!avatarUrl) return;
        try {
            const response = await axios.get(avatarUrl, { responseType: 'arraybuffer' });
            const data = Buffer.from(response.data).toString('base64');

            if (isOrg) {
                await this.api.post(`/orgs/${name}/avatar`, {
                    image: data
                });
            } else {
                await this.api.post(`/user/avatar`, {
                    image: data
                }, {
                    headers: {
                        "Sudo": name
                    }
                });
            }
        } catch { }
    }

    private toError(err: any, context: string): Error {
        return new Error(`${context}: ${this.errorMessage(err)}`);
    }

    private validUrl(value: string | null): string {
        if (!value) return "";

        try {
            const url = new URL(value);
            return url.protocol === "http:" || url.protocol === "https:" ? value : "";
        } catch {
            return "";
        }
    }

    private errorMessage(err: any): string {
        if (!axios.isAxiosError(err)) return err?.message || String(err);

        const status = err.response?.status;
        const data = err.response?.data;
        const detail = typeof data === "string" ? data : data ? JSON.stringify(data) : err.message;

        return status ? `HTTP ${status}: ${detail}` : err.message;
    }
}
