"use client";

import Link from "next/link";

export default function DashboardPage() {
  const principal = 50000000;
  const dailyProfit = Math.floor((principal * 0.05) / 30);
  const wallet = 12450000;
  const totalProfit = 4250000;

  const money = (value: number) =>
    new Intl.NumberFormat("fa-IR").format(value);

  return (
    <main className="dashboardPage" dir="rtl">
      <header className="dashHeader">
        <Link href="/" className="dashLogo">
          RET
        </Link>

        <div className="userBadge">حساب کاربری</div>
      </header>

      <section className="dashContainer">
        <div className="dashTitle">
          <span>پنل سرمایه‌گذار</span>
          <h1>داشبورد</h1>
          <p>مدیریت سرمایه، سود، کیف پول و دعوت دوستان</p>
        </div>

        <div className="statsGrid">
          <StatCard
            title="اصل سرمایه فعال"
            value={`${money(principal)} تومان`}
          />

          <StatCard
            title="سود امروز"
            value={`${money(dailyProfit)} تومان`}
            green
          />

          <StatCard
            title="سود کل دریافت‌شده"
            value={`${money(totalProfit)} تومان`}
          />

          <StatCard
            title="موجودی کیف پول"
            value={`${money(wallet)} تومان`}
          />
        </div>

        <div className="dashGrid">
          <section className="dashPanel">
            <div className="panelTop">
              <div>
                <span className="panelLabel">سود روزانه</span>
                <h2>{money(dailyProfit)} تومان</h2>
              </div>

              <span className="readyBadge">آماده دریافت</span>
            </div>

            <p className="panelText">
              سود امروزت آماده است. برای دریافت وارد صفحه مخصوص سود روزانه شو.
            </p>

            <Link className="dashPrimary" href="/daily-profit">
              دریافت سود امروز
            </Link>
          </section>

          <section className="dashPanel">
            <span className="panelLabel">کیف پول</span>
            <h2>{money(wallet)} تومان</h2>

            <p className="panelText">
              سودها و پاداش‌های دعوت بعد از دریافت به کیف پول اضافه می‌شوند.
            </p>

            <button className="dashPrimary">درخواست برداشت</button>
          </section>
        </div>

        <section className="dashPanel">
          <div className="panelTop">
            <div>
              <span className="panelLabel">سرمایه‌گذاری فعال</span>
              <h2>{money(principal)} تومان</h2>
            </div>

            <span className="activeBadge">● فعال</span>
          </div>

          <div className="infoRow">
            <span>نرخ ماهانه</span>
            <strong>۵٪</strong>
          </div>

          <div className="infoRow">
            <span>حداقل سرمایه</span>
            <strong>۵۰٬۰۰۰ تومان</strong>
          </div>

          <button className="dashOutline">برداشت اصل سرمایه</button>
        </section>

        <section className="dashPanel referralPanel">
          <span className="panelLabel">دعوت دوستان</span>

          <h2>۲٪ پاداش از سود روزانه دوستان</h2>

          <p className="panelText">
            هر کاربر یک کد دعوت اختصاصی دارد. از سود روزانه دوستان مستقیم خود
            پاداش دریافت می‌کنی.
          </p>

          <div className="refCode">RET7X9K</div>

          <button className="dashPrimary">اشتراک‌گذاری کد دعوت</button>
        </section>

        <section className="dashPanel">
          <span className="panelLabel">آخرین تراکنش‌ها</span>

          <Transaction
            title="دریافت سود روزانه"
            amount={`+${money(dailyProfit)} تومان`}
          />

          <Transaction
            title="پاداش دعوت"
            amount="+۲٬۴۵۰ تومان"
          />

          <Transaction
            title="برداشت کیف پول"
            amount="-۵۰۰٬۰۰۰ تومان"
            negative
          />

          <Transaction
            title="افزایش سرمایه"
            amount="+۵٬۰۰۰٬۰۰۰ تومان"
          />
        </section>
      </section>
    </main>
  );
}

function StatCard({
  title,
  value,
  green = false,
}: {
  title: string;
  value: string;
  green?: boolean;
}) {
  return (
    <div className="statCard">
      <span>{title}</span>
      <strong className={green ? "greenValue" : ""}>
        {value}
      </strong>
    </div>
  );
}

function Transaction({
  title,
  amount,
  negative = false,
}: {
  title: string;
  amount: string;
  negative?: boolean;
}) {
  return (
    <div className="statCard">
      <span>{title}</span>
      <strong className={green ? "greenValue" : ""}>{value}</strong>
    </div>
  );
}
