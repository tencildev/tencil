interface PricingCardProps {
    name: string;
    price: number;
    features: string[];
    featured?: boolean;
}

export function PricingCard({ name, price, features, featured }: PricingCardProps) {
    return (
        <article className={featured ? 'card card-featured' : 'card'}>
            <h2>{name}</h2>
            <p className="price">
                ${price}
                <span>/month</span>
            </p>
            <ul>
                {features.map(feature => (
                    <li key={feature}>{feature}</li>
                ))}
            </ul>
            <button type="button" className="button">
                Choose {name}
            </button>
        </article>
    );
}
