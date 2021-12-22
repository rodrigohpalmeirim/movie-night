const fetch = require("node-fetch");

module.exports = getYoutubeDirectUrl;

function getYoutubeDirectUrl(url) {
    return new Promise(resolve => {
        fetch("https://yt1s.com/api/ajaxSearch/index", {
            "headers": { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            "body": `q=${url}&vt=home`,
            "method": "POST"
        }).then(res => res.json()).then(json => {
            try {
                let sizes = Object.values(json.links.mp4);
                let k;
                try {
                    k = sizes.filter(v => v.q == "1080p")[0].k;
                } catch (error) {
                    k = sizes[sizes.length - 2].k;
                }
                k = encodeURIComponent(k);
    
                fetch("https://yt1s.com/api/ajaxConvert/convert", {
                    "headers": { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
                    "body": `vid=${json.vid}&k=${k}`,
                    "method": "POST"
                }).then(res => res.json()).then(json => {
                    resolve(json.dlink);
                }).catch(error => {
                    console.log(error);
                    resolve(null);
                });
            } catch (error) {
                console.log(error);
                resolve(null);
            }
        }).catch(error => {
            console.log(error);
            resolve(null);
        });
    });
}