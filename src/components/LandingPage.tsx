/**
 * The public site shown to signed-out visitors. It is a small multi-page marketing site that lives in
 * src/landing (home, modules and one page per module, smart features, security, how it works).
 */
import React from 'react';
import { MarketingSite } from '../landing/MarketingSite';

export const LandingPage: React.FC = () => <MarketingSite />;

export default LandingPage;
