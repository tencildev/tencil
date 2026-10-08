export function Navbar() {
    return (
        <header className="navbar">
            <a className="logo" href="/">
                Acme
            </a>
            <nav>
                <a href="#pricing">Pricing</a>
                <a href="#docs">Docs</a>
                <button type="button" className="button button-small">
                    Sign in
                </button>
            </nav>
        </header>
    );
}
