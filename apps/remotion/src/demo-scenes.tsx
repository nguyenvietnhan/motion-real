import React from "react";
import { z } from "zod";
import { registerComponent, type SceneComponentProps } from "@news/compositions";
import { Frame, Content, TitleBlock, KeyPoints, Callout, IdeaPanel } from "@news/blocks";

/**
 * App-local DEMO scenes for the Studio preview + no-voice sample draft. These
 * are NOT built-in templates in `@news/compositions` (pure AUTHOR mode keeps
 * that package template-free) — they live in the app, compose `@news/blocks`,
 * and exist only so `render --sample` / Studio show real on-brand visuals
 * without a per-project authored bundle. Importing this module registers them.
 */

const heroSchema = z.object({ callout: z.string().optional() });
type HeroProps = z.infer<typeof heroSchema>;
const DemoHero: React.FC<SceneComponentProps<HeroProps>> = ({ headline, body, props }) => (
  <Frame>
    <Content>
      <TitleBlock headline={headline} body={body} />
      {props.callout ? <Callout tone="accent">{props.callout}</Callout> : null}
    </Content>
  </Frame>
);
export const demoHero = registerComponent<HeroProps>({
  id: "demo-hero",
  displayName: "Demo Hero",
  promptGuide: "Sample/Studio hook scene.",
  schema: heroSchema,
  Component: DemoHero,
  example: { callout: "Tự do có kỷ luật" },
});

const pointsSchema = z.object({ points: z.array(z.string()).min(1).max(6) });
type PointsProps = z.infer<typeof pointsSchema>;
const DemoPoints: React.FC<SceneComponentProps<PointsProps>> = ({ headline, body, props }) => (
  <Frame>
    <Content>
      <TitleBlock headline={headline} body={body} />
      <KeyPoints items={props.points} />
    </Content>
  </Frame>
);
export const demoPoints = registerComponent<PointsProps>({
  id: "demo-points",
  displayName: "Demo Key Points",
  promptGuide: "Sample/Studio enumerated-list scene.",
  schema: pointsSchema,
  Component: DemoPoints,
  example: { points: ["Một", "Hai", "Ba"] },
});

const ideaSchema = z.object({ idea: z.string(), label: z.string().optional() });
type IdeaProps = z.infer<typeof ideaSchema>;
const DemoIdea: React.FC<SceneComponentProps<IdeaProps>> = ({ headline, body, props }) => (
  <Frame>
    <Content>
      <TitleBlock headline={headline} body={body} />
      <IdeaPanel title={props.label} emphasis>
        {props.idea}
      </IdeaPanel>
    </Content>
  </Frame>
);
export const demoIdea = registerComponent<IdeaProps>({
  id: "demo-idea",
  displayName: "Demo Idea Panel",
  promptGuide: "Sample/Studio single-idea scene.",
  schema: ideaSchema,
  Component: DemoIdea,
  example: { idea: "Một ý chính", label: "Ý" },
});

const ctaSchema = z.object({ question: z.string() });
type CtaProps = z.infer<typeof ctaSchema>;
const DemoCta: React.FC<SceneComponentProps<CtaProps>> = ({ headline, body, props }) => (
  <Frame>
    <Content align="center">
      <TitleBlock headline={headline} body={body} />
      <Callout tone="signal">{props.question}</Callout>
    </Content>
  </Frame>
);
export const demoCta = registerComponent<CtaProps>({
  id: "demo-cta",
  displayName: "Demo CTA",
  promptGuide: "Sample/Studio closing CTA scene.",
  schema: ctaSchema,
  Component: DemoCta,
  example: { question: "Bạn sẽ xây lưới an toàn nào trước?" },
});
