import { Hero } from "./components/Hero.tsx";
import { Navbar } from "./components/Navbar.tsx";
import { PricingCard } from "./components/PricingCard.tsx";

const plans = [
  { name: "Hobby", price: 0, features: ["1 project", "Community support"] },
  {
    name: "Pro",
    price: 20,
    features: ["Unlimited projects", "Email support", "Analytics"],
    featured: true,
  },
  { name: "Team", price: 50, features: ["Everything in Pro", "SSO", "Audit log"] },
];

export function App() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <section className="pricing" id="pricing">
          {plans.map((plan) => (
            <PricingCard key={plan.name} {...plan} />
          ))}
        </section>
      </main>
    </>
  );
}
