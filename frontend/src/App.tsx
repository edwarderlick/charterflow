import React, { useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
} from 'react-router-dom';
import { DataProvider } from './services/dataAccess';
import { WalletProvider } from './context/WalletContext';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { DesignPreviewBanner } from './components/DesignPreviewBanner';

import { LandingPage } from './pages/LandingPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { ExploreRoundsPage } from './pages/ExploreRoundsPage';
import { CreateRoundPage } from './pages/CreateRoundPage';
import { RoundDetailPage } from './pages/RoundDetailPage';
import { NominateProposalPage } from './pages/NominateProposalPage';
import { ProposalDetailPage } from './pages/ProposalDetailPage';
import { MyActivityPage } from './pages/MyActivityPage';
import { TransactionNetworkStatesPage } from './pages/TransactionNetworkStatesPage';
import { NotFoundPage } from './pages/NotFoundPage';

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <WalletProvider>
        <DataProvider>
          <ScrollToTop />
          <div className="flex flex-col min-h-screen bg-[#131313] text-[#e5e2e1]">
            <Header />
            <DesignPreviewBanner />
            <main className="flex-1 flex flex-col">
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/how-it-works" element={<HowItWorksPage />} />
                <Route path="/rounds" element={<ExploreRoundsPage />} />
                <Route path="/rounds/new" element={<CreateRoundPage />} />
                <Route path="/rounds/create" element={<CreateRoundPage />} />
                <Route path="/create-round" element={<CreateRoundPage />} />
                <Route path="/rounds/:id" element={<RoundDetailPage />} />
                <Route path="/rounds/:id/nominate" element={<NominateProposalPage />} />
                <Route path="/proposals/nominate/:id" element={<NominateProposalPage />} />
                <Route path="/proposals/:id" element={<ProposalDetailPage />} />
                <Route path="/activity" element={<MyActivityPage />} />
                <Route path="/network" element={<TransactionNetworkStatesPage />} />
                {/* Fallback route */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </main>
            <Footer />
          </div>
        </DataProvider>
      </WalletProvider>
    </BrowserRouter>
  );
};

export default App;
