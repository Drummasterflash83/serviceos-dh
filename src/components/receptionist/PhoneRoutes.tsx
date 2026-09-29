import { ArrowRight, Clock3, Mail, Moon, PhoneMissed, Route } from "lucide-react";
import { phoneRouteSections, type RecordedPhoneRoute } from "@/lib/phone-route-layout";

const icons = {
  office: Clock3,
  closed: Moon,
  fallback: PhoneMissed,
  voicemail: Mail,
  reference: Route,
};
export function PhoneRoutes({ routes }: { routes: RecordedPhoneRoute[] }) {
  return (
    <div className="ps-route-sections">
      {routes.flatMap((route, routeIndex) =>
        phoneRouteSections(route).map((section, sectionIndex) => {
          const Icon = icons[section.kind];
          const id = `phone-route-${routeIndex}-${sectionIndex}`;
          return (
            <section
              className={`ps-route-section ps-route-${section.kind}`}
              key={id}
              aria-labelledby={id}
            >
              <header>
                <span className="ps-route-icon">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h4 id={id}>{section.title}</h4>
                {section.menu && <span className="ps-route-menu">Menu {section.menu}</span>}
              </header>
              {!!section.rows.length && (
                <dl className="ps-route-rows">
                  {section.rows.map((row, i) => (
                    <div key={i} className={row.fallback ? "ps-route-fallback-row" : ""}>
                      <dt>{row.trigger}</dt>
                      <dd>
                        <ArrowRight size={16} aria-hidden="true" />
                        <span>{row.destination}</span>
                        {row.extension && (
                          <span className="ps-route-destination">{row.extension}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {section.note && <p className="ps-route-note">{section.note}</p>}
              <details className="ps-route-record">
                <summary>
                  {route.date} <span>View record</span>
                </summary>
                <p>{route.detail}</p>
              </details>
            </section>
          );
        }),
      )}
    </div>
  );
}
