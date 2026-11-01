import type { PageRule } from "../types.js";
import { nodesOf } from "./_helpers.js";

const PROPS = ["aggregateRating", "review", "reviews"];

export const rule: PageRule = {
  meta: {
    id: "schema/fake-rating",
    title: "Ratings or reviews in markup without real reviews",
    category: "schema",
    severity: "error",
    scope: "page",
    inputs: ["dir", "url"],
    launchBlocking: true,
    fix: "Remove aggregateRating/review markup, or set business.hasReviews to true once genuine, visible reviews exist.",
    source:
      "https://developers.google.com/search/docs/appearance/structured-data/review-snippet",
  },
  checkPage(page, ctx) {
    const business = ctx.config.business;
    if (business === undefined || business.hasReviews === true) return;
    const found = PROPS.filter((p) => nodesOf(page).some((n) => p in n));
    if (found.length > 0)
      ctx.report({
        message: `Markup contains ${found.join(", ")} but business.hasReviews is false`,
        details: { properties: found },
      });
  },
};
