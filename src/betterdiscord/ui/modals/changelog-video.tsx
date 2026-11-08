import React from "react";

export function isYoutubeEmbed(src: string): boolean {
    try {
        const url = new URL(src);
        return url.protocol === "https:" && !url.username && !url.password
            && ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "youtube-nocookie.com"].includes(url.hostname)
            && /^\/embed\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
    }
    catch {return false;}
}

function YoutubeEmbed({src}: {src: string;}) {
    const [approved, setApproved] = React.useState(false);
    const url = new URL(src);
    const localChoice = `https://www.youtube-nocookie.com${url.pathname}`;
    return approved ? <iframe
        src={localChoice}
        title="YouTube video player"
        frameBorder="0"
        allow="encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="no-referrer"
        allowFullScreen
    /> : <div className="bd-changelog-video-consent"><p>Loading this video connects to YouTube and shares your IP address with it.</p><button type="button" onClick={() => setApproved(true)}>Load YouTube video</button></div>;
}

export default function ChangelogVideo({src, poster}: {src: string; poster?: string;}) {
    if (isYoutubeEmbed(src)) return <YoutubeEmbed key={src} src={src} />;
    return <video src={src} poster={poster} preload="none" controls={true} className="bd-changelog-poster" />;
}
