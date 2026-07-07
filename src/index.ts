import { config } from "./config.js";
import { GithubClient } from "./github.js";
import { ForgejoClient } from "./forgejo.js";
import ora, { Ora } from "ora";
import chalk from "chalk";

const github = new GithubClient(config.githubToken);
const forgejo = new ForgejoClient(config.forgejoUrl, config.forgejoToken, config.forgejoOrgOwner);

async function main() {
    const spinner = ora("Starting gh2fj...").start();

    if (!config.githubToken || !config.forgejoUrl || !config.forgejoToken) {
        spinner.fail(chalk.red("Missing required environment variables"));
        process.exit(1);
    }

    try {
        const authUser = await github.getAuthenticatedUser();
        spinner.info(chalk.blue(`Authenticated as GH user: ${authUser}`));

        for (const username of config.githubUsers) {
            await processUser(username, spinner);
        }

        for (const orgName of config.githubOrgs) {
            await processOrg(orgName, spinner);
        }

        spinner.succeed(chalk.bold.green("Mirroring completed!"));
    } catch (err: any) {
        spinner.fail(chalk.red(`Fatal error: ${err.message}`));
        process.exit(1);
    }
}

async function processUser(username: string, spinner: Ora) {
    spinner.start(`Processing GH User: ${username}`);
    try {
        const user = await github.getUser(username);
        await forgejo.ensureUser(user);

        spinner.text = `Fetching repos for ${username}...`;
        const repos = await github.getUserRepos(username);

        await processRepos(repos, username, spinner, config.githubToken);
    } catch (err: any) {
        spinner.fail(chalk.red(`Failed to process user ${username}: ${err.message}`));
    }
}

async function processOrg(orgName: string, spinner: Ora) {
    spinner.start(`Processing GH Org: ${orgName}`);
    try {
        const org = await github.getOrg(orgName);
        await forgejo.ensureOrg(org);

        spinner.text = `Fetching repos for ${orgName}...`;
        const repos = await github.getOrgRepos(orgName);

        await processRepos(repos, orgName, spinner, config.githubToken);
    } catch (err: any) {
        spinner.warn(chalk.yellow(`Skipping org ${orgName}: ${err.message}`));
    }
}

async function processRepos(repos: any[], owner: string, spinner: Ora, token: string) {
    let migrated = 0;
    let exists = 0;
    let total = repos.length;
    const errors: string[] = [];

    spinner.text = `Processing ${total} repos for ${owner}...`;

    for (const repo of repos) {
        try {
            const status = await forgejo.migrateRepo(
                repo.clone_url,
                repo.name,
                owner,
                repo.description,
                token
            );

            if (status === "migrated") {
                migrated++;
            } else if (status === "exists" || status === "updated_private") {
                exists++;
            } else if (status && status.startsWith("error")) {
                errors.push(`${repo.name}: ${status.substring(7)}`);
            }
        } catch (err: any) {
            errors.push(`${repo.name}: ${err.message}`);
        }
        spinner.text = `${owner}: ${migrated} migrated, ${exists} existing, ${errors.length} errors (${total} total)`;
    }

    if (errors.length > 0) {
        spinner.fail(chalk.yellow(`${owner}: ${migrated} migrated, ${exists} existing, ${errors.length} errors.`));

        for (const msg of errors) {
            console.error(chalk.red(`  -> ${msg}`));
        }
    } else {
        spinner.succeed(chalk.green(`${owner}: ${migrated} migrated, ${exists} existing, ${errors.length} errors.`));
    }
}

main();
