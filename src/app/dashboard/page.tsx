import Link from "next/link";

export default function DashboardPage() {
  return (
    <main className="dashboard" dir="rtl">
      <div className="container">

        <nav className="nav">
          <div className="brand">
            <div className="brand-mark">R</div>
            <div className="logo">RET</div>
          </div>

          <Link className="btn btn-ghost" href="/">
            صفحه اصلی
          </Link>
        </nav>

        <div className="dash-head">
          <div>
            <div className="kicker">داشبورد سرمایه‌گذار</div>
            <h1 style={{ fontSize: 34, margin: "12px 0 0" }}>
              خوش اومدی 👋
            </h1>
            <p className="section-sub">
              مدیریت سرمایه، سود روزانه و کیف پول
            </p>
          </div>
        </div>

        <section className="dash-grid">
          <div className="panel">
            <div className="label">اصل سرمایه فعال</div>
            <div className="value">۵۰٬۰۰۰٬۰۰۰ تومان</div>
          </div>

          <div className="panel">
            <div className="label">سود امروز</div>
            <div className="value" style={{ color: "#28c785" }}>
              +۸۳٬۳۳۳ تومان
            </div>
          </div>

          <div className="panel">
            <div className="label">سود کل دریافتی</div>
            <div className="value">۴٬۲۵۰٬۰۰۰ تومان</div>
          </div>

          <div className="panel">
            <div className="label">موجودی کیف پول</div>
            <div className="value">۱۲٬۴۵۰٬۰۰۰ تومان</div>
          </div>
        </section>

        <section className="wallet">
          <div className="panel">
            <div className="label">دریافت سود روزانه</div>

            <div className="value" style={{ color: "#28c785" }}>
              ۸۳٬۳۳۳ تومان
            </div>

            <p className="section-sub">
              سود امروز آماده دریافت است.
            </p>

            <Link className="btn btn-primary" href="/daily-profit">
              دریافت سود امروز
            </Link>
          </div>

          <div className="panel">
            <div className="label">کیف پول</div>
            <div className="value">۱۲٬۴۵۰٬۰۰۰ تومان</div>

            <p className="section-sub">
              سود و پاداش‌های دریافتی در این بخش نمایش داده می‌شوند.
            </p>

            <button className="btn btn-primary">
              درخواست برداشت
            </button>
          </div>
        </section>

        <section className="wallet">
          <div className="panel">
            <div className="label">دعوت دوستان</div>
            <div className="value">۲٪ پاداش</div>

            <p className="section-sub">
              با دعوت مستقیم دوستان، از سود روزانه آن‌ها پاداش دریافت می‌کنی.
            </p>

            <div className="ref-code">
              RET7X9K
            </div>
          </div>

          <div className="panel">
            <div className="label">آمار دعوت</div>
            <div className="value">۸ دوست فعال</div>

            <p className="section-sub">
              پاداش امروز:
              <span style={{ color: "#28c785" }}>
                {" "}+۲٬۴۰۰ تومان
              </span>
            </p>
          </div>
        </section>

        <section className="panel" style={{ marginTop: 16 }}>
          <div className="value" style={{ fontSize: 20 }}>
            آخرین تراکنش‌ها
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>نوع</th>
                <th>مبلغ</th>
                <th>وضعیت</th>
              </tr>
            </thead>

            <tbody>
              <tr>
                <td>سود روزانه</td>
                <td style={{ color: "#28c785" }}>
                  +۸۳٬۳۳۳
                </td>
                <td>ثبت شد</td>
              </tr>

              <tr>
                <td>پاداش دعوت</td>
                <td style={{ color: "#28c785" }}>
                  +۲٬۴۰۰
                </td>
                <td>ثبت شد</td>
              </tr>

              <tr>
                <td>برداشت کیف پول</td>
                <td>۵۰۰٬۰۰۰</td>
                <td>در حال بررسی</td>
              </tr>
            </tbody>
          </table>
        </section>

      </div>
    </main>
  );
}
