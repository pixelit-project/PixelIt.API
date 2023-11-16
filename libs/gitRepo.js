const axios = require('axios').default;
const ini = require('ini');
const log = require('./logger');
let authConf = null;

async function getGitReleases() {

    if (process.env.GITHUB_TOKEN) {
        authConf = { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } };
    }

    const gitReleases = [];
    try {
        const res = await axios.get('https://api.github.com/repos/pixelit-project/PixelIt/releases', authConf);
        // No prereleases
        const releases = res.data;//.filter(x => x.prerelease == false);
        log.info('GitAPIRateLimit: Limit: {rateLimitLimit}, Remaining: {rateLimitRemaining}, Used: {rateLimitUsed}, Reset at {rateLimitReset}', {
            rateLimitLimit: res.headers['x-ratelimit-limit'],
            rateLimitRemaining: res.headers['x-ratelimit-remaining'],
            rateLimitUsed: res.headers['x-ratelimit-used'],
            rateLimitReset: new Date(res.headers['x-ratelimit-reset'] * 1000).toLocaleString()
        });

        for (const release of releases) {
            const data = {
                version: release.name,
                prerelease: release.prerelease,
                date: release.published_at.split("T")[0],
                downloads: release.assets.reduce((result, x) => result + x.download_count, 0),
                downloadURL: release.html_url,
                fwdownloads: [],
                releaseNoteArray: release.body.replaceAll("-", "").split("\r\n"),
                readmeLink: `https://github.com/pixelit-project/PixelIt#${release.name.replaceAll(".", "")}-${release.published_at.split("T")[0]}`,
            };
            for (const asset of release.assets) {
                let fwdownload;
                // New filename format https://github.com/pixelit-project/PixelIt/pull/153
                // firmware_v3.3.3_wemos_d1_mini32.bin
                if (asset.name.includes("firmware_v")) {
                    fwdownload = {
                        name: asset.name.substring(asset.name.indexOf(asset.name.split("_")[2])),
                        downloads: asset.download_count,
                    };
                    // Old filename format
                    // firmware_wemos_d1_mini32.bin
                } else {
                    fwdownload = {
                        name: asset.name.substring(asset.name.indexOf(asset.name.split("_")[1])),
                        downloads: asset.download_count,
                    };
                }
                fwdownload.name = fwdownload.name.replace(".bin", "").replaceAll("_", " ").toUpperCase();
                data.fwdownloads.push(fwdownload);
            }
            gitReleases.push(data);
        }
        return (gitReleases);
    } catch (error) {
        log.error('getCurrentGitReleaseData: error {error}', { error });
        return [];
    }
}

async function getOfficialBuilds() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/pixelit-project/PixelIt/main/platformio.ini');
        const config = ini.parse(res.data)
        const officialBuilds = Object.values(config).map(x => x['-DBUILD_SECTION']).filter(x => x != undefined)
        return officialBuilds;
    } catch (error) {
        log.error('getOfficialBuilds: error {error}', { error });
        return [];
    }


}

module.exports = {
    getGitReleases,
    getOfficialBuilds,
}