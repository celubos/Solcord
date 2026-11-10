import React, {type ReactNode} from "react";
import DiscordModules from "@modules/discordmodules";
import {t} from "@common/i18n";

import Root from "./root";
import Header from "./header";
import Footer from "./footer";
import Content from "./content";

import Flex from "../base/flex";
import Text from "../base/text";
import CloseButton from "./close";

import SimpleMarkdownExt from "@structs/markdown";
import {GithubIcon} from "lucide-react";
import {getByKeys} from "@webpack";
import Video from "./changelog-video";

const {useMemo} = React;


const AnchorClasses: {anchor: string; anchorUnderlineOnHover: string;} = getByKeys(["anchorUnderlineOnHover"], {
    firstId: 820162,
    cacheId: "core-changelog-anchorClasses"
}) || {anchor: "anchor-3Z-8Bb", anchorUnderlineOnHover: "anchorUnderlineOnHover-2ESHQB"};

const defaultFooter = <Text>
    <a className={`${AnchorClasses.anchor} ${AnchorClasses.anchorUnderlineOnHover}`} href="https://github.com/celubos/Solcord/issues" rel="noopener noreferrer" target="_blank">Solcord issues</a>
    {" · "}
    <a className={`${AnchorClasses.anchor} ${AnchorClasses.anchorUnderlineOnHover}`} href="https://github.com/BetterDiscord/BetterDiscord" rel="noopener noreferrer" target="_blank">Based on BetterDiscord</a>
</Text>;

const github = <DiscordModules.Tooltip color="primary" position="top" text={t("Socials.github")}>
    {p => <a {...p} className="bd-social" href="https://github.com/celubos/Solcord" rel="noopener noreferrer" target="_blank">
        <GithubIcon size="18px" />
    </a>}
</DiscordModules.Tooltip>;

export type ChangelogEntryType = "progress" | "fixed" | "added" | "improved";
export interface ChangelogEntry {
    type: ChangelogEntryType;
    blurb?: string;
    title: string;
    items: string[];
}

export interface ChangelogProps {
    transitionState?: number;
    /** What to show in the modal footer */
    footer?: ReactNode;
    /** Title to show in the modal header */
    title?: ReactNode;
    /** Title to show below the main header */
    subtitle?: ReactNode;
    /** A callback to fire when the changelog modal is closed */
    onClose?(): void;
    /** Youtube link or url of a video file to use as the banner */
    video?: string;
    /** URL to use for the video freeze-frame poster */
    poster?: string;
    /** URL to an image to display as the banner of the modal */
    banner?: string;
    /** Text to show in the body of the modal before the list of changes */
    blurb?: string;
    /** List of changes to show (see description for details) */
    changes?: ChangelogEntry[];
}

export default function ChangelogModal({transitionState, footer, title, subtitle, onClose, video, poster, banner, blurb, changes}: ChangelogProps) {

    const ChangelogHeader = useMemo(() => <Header justify={Flex.Justify.BETWEEN}>
        <Flex direction={Flex.Direction.VERTICAL}>
            <Text tag="h1" size={Text.Sizes.SIZE_20} strong={true}>{title}</Text>
            <Text size={Text.Sizes.SIZE_12} color={Text.Colors.MUTED}>{subtitle}</Text>
        </Flex>
        <CloseButton onClick={onClose} />
    </Header>, [title, subtitle, onClose]);

    const ChangelogFooter = useMemo(() => <Footer justify={Flex.Justify.BETWEEN} direction={Flex.Direction.HORIZONTAL}>
        <Flex.Child grow="1" shrink="1">
            {footer ? footer : defaultFooter}
        </Flex.Child>
        {!footer && <Flex.Child grow="0" shrink="0">
            {github}
        </Flex.Child>}
    </Footer>, [footer]);

    const changelogItems = useMemo(() => {
        const items = [];
        if (video) items.push(<Video src={video} poster={poster} />);
        else if (banner) items.push(<img src={banner} className="bd-changelog-poster" />);

        if (blurb) items.push(<p>{SimpleMarkdownExt.parseToReact(blurb)}</p>);

        for (let c = 0; c < (changes?.length ?? 0); c++) {
            const entry = changes![c];
            const type = "bd-changelog-" + entry.type;
            const margin = c == 0 ? " bd-changelog-first" : "";
            items.push(<h1 className={`bd-changelog-title ${type}${margin}`}>{entry.title}</h1>);
            if (entry.blurb) items.push(<p>{SimpleMarkdownExt.parseToReact(entry.blurb)}</p>);
            const list = <ul>{entry.items.map(i => <li>{SimpleMarkdownExt.parseToReact(i)}</li>)}</ul>;
            items.push(list);
        }
        return items;
    }, [blurb, video, banner, poster, changes]);

    return <Root className="bd-changelog-modal" transitionState={transitionState} size={Root.Sizes.MEDIUM} style={Root.Styles.STANDARD}>
        {ChangelogHeader}
        <Content>{changelogItems}</Content>
        {(footer || title === "Solcord") && ChangelogFooter}
    </Root>;
}
