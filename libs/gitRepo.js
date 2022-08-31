const axios = require('axios').default
const log = require('./logger')
let authConf = null;

async function getGitReleases() {

    if (process.env.GITHUB_TOKEN) {
        authConf = { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } };
    }

    const gitReleases = [];
    try {
        const res = await axios.get('https://api.github.com/repos/pixelit-project/PixelIt/releases', authConf);
        const gitData = res.data;
        log.info('GitAPIRateLimit: Limit: {rateLimitLimit}, Remaining: {rateLimitRemaining}, Used: {rateLimitUsed}, Reset at {rateLimitReset}', {
            rateLimitLimit: res.headers['x-ratelimit-limit'],
            rateLimitRemaining: res.headers['x-ratelimit-remaining'],
            rateLimitUsed: res.headers['x-ratelimit-used'],
            rateLimitReset: new Date(res.headers['x-ratelimit-reset'] * 1000).toLocaleString()
        });

        for (let i = 0; i < 4; i++) {
            const data = {
                version: gitData[i].name,
                date: gitData[i].published_at.split("T")[0],
                downloads: gitData[i].assets.reduce((result, x) => result + x.download_count, 0),
                downloadURL: gitData[i].html_url,
                fwdownloads: [],
                releaseNoteArray: gitData[i].body.replaceAll("-", "").split("\r\n"),
                readmeLink: `https://github.com/pixelit-project/PixelIt#${gitData[i].name.replaceAll(".", "")}-${gitData[i].published_at.split("T")[0]}`,
            };
            for (const asset of gitData[i].assets) {
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

module.exports = {
    getGitReleases,
}