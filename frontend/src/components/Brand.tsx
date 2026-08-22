import { Link } from 'react-router-dom';

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="AI Crop Disease Detection System home">
      <svg className="brand__mark" viewBox="0 0 44 44" aria-hidden="true">
        <rect width="44" height="44" rx="13" fill="currentColor" />
        <path d="M11 29.5c10.3 1.8 18.3-3.7 20.9-16.7-10.6-1-19 5.4-20.9 16.7Z" fill="#e1ec85" />
        <path d="M12.7 33c3.7-7.1 9.4-11.7 17.2-16M20.6 25l-1.1-5.3m1.1 5.3 6 .2" fill="none" stroke="#123f32" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="brand__text">
        <strong>Crop Disease</strong>
        <small>AI Detection System</small>
      </span>
    </Link>
  );
}
