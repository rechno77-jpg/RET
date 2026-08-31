"use client";

import { useState } from "react";

export default function DashboardPage() {
  const [claimed, setClaimed] = useState(false);

  const principal = 1000000;
  const dailyProfit = Math.floor((principal * 0.05) / 30);
  const wallet = 128450;

  const money = (value: number) =>
    new Intl.NumberFormat("fa-IR").format(value);

  return (
    <main
      dir="rtl"
      style={{
        minHeight: "100vh",
        background: "#050914",
        color: "#fff",
        fontFamily: "Tahoma, Arial, sans-serif",
        paddingBottom: "50px",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "22px 18px",
          borderBottom: "1px solid #172033",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "25px",
              fontWeight: 900,
              color: "#3b82f6",
            }}
          >
            RECHNO
          </div>

          <div style={{ color: "#8b9bb4", fontSize: "12px" }}>
            پنل سرمایه‌گذاری
          </div>
        </div>

        <div
          style={{
            background: "#101827",
            padding: "10px 14px",
            borderRadius: "12px",
            fontSize: "13px",
          }}
        >
          حساب کاربری
        </div>
      </header>

      <section
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          padding: "25px 16px",
        }}
      >
        <div style={{ marginBottom: "25px" }}>
          <div style={{ color: "#8b9bb4", fontSize: "14px" }}>
            خوش آمدید 👋
          </div>

          <h1
            style={{
              margin: "7px 0",
              fontSize: "27px",
            }}
          >
            داشبورد سرمایه‌گذاری
          </h1>
        </div>

        {/* Statistics */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
            gap: "12px",
          }}
        >
          <Card
            title="سرمایه فعال"
            value={`${money(principal)} تومان`}
          />

          <Card
            title="سود امروز"
            value={`${money(dailyProfit)} تومان`}
          />

          <Card
            title="موجودی کیف پول"
            value={`${money(wallet)} تومان`}
          />

          <Card title="سود ماهانه" value="۵٪" />
        </div>

        {/* Daily profit */}
        <div style={panel}>
          <div>
            <div style={smallTitle}>سود روزانه</div>

            <h2 style={{ margin: "8px 0" }}>
              {money(dailyProfit)} تومان
            </h2>

            <div style={description}>
              برای دریافت سود امروز روی دکمه زیر بزنید.
            </div>
          </div>

          <button
            onClick={() => setClaimed(true)}
            disabled={claimed}
            style={{
              ...primaryButton,
              opacity: claimed ? 0.55 : 1,
            }}
          >
            {claimed ? "✓ سود امروز دریافت شد" : "دریافت سود امروز"}
          </button>
        </div>

        {/* Investment */}
        <div style={panel}>
          <div style={smallTitle}>سرمایه‌گذاری فعال</div>

          <div style={row}>
            <span>اصل سرمایه</span>
            <strong>{money(principal)} تومان</strong>
          </div>

          <div style={row}>
            <span>نرخ سود ماهانه</span>
            <strong style={{ color: "#34d399" }}>۵٪</strong>
          </div>

          <div style={row}>
            <span>وضعیت</span>
            <strong style={{ color: "#34d399" }}>فعال ●</strong>
          </div>

          <button style={outlineButton}>
            برداشت اصل سرمایه
          </button>
        </div>

        {/* Wallet */}
        <div style={panel}>
          <div style={smallTitle}>کیف پول من</div>

          <h2 style={{ margin: "10px 0" }}>
            {money(wallet)} تومان
          </h2>

          <div style={description}>
            سود روزانه و پاداش دعوت دوستان به این کیف پول اضافه می‌شود.
          </div>

          <button style={primaryButton}>
            درخواست برداشت
          </button>
        </div>

        {/* Referral */}
        <div
          style={{
            ...panel,
            background:
              "linear-gradient(135deg,#101a31,#07182a)",
          }}
        >
          <div style={smallTitle}>🎁 دعوت دوستان</div>

          <h2>از سود دوستانت درآمد بگیر</h2>

          <p style={description}>
            با دعوت دوستان، معادل ۲٪ از سود روزانه‌ای که
            دریافت می‌کنند به کیف پول شما اضافه می‌شود.
          </p>

          <div
            style={{
              background: "#050914",
              border: "1px dashed #3b82f6",
              borderRadius: "14px",
              padding: "15px",
              textAlign: "center",
              marginTop: "18px",
            }}
          >
            <div style={{ color: "#8b9bb4", fontSize: "12px" }}>
              کد دعوت شما
            </div>

            <div
              style={{
                fontSize: "22px",
                fontWeight: 900,
                letterSpacing: "2px",
                marginTop: "7px",
                direction: "ltr",
              }}
            >
              RECHNO-AB12CD
            </div>
          </div>

          <button style={primaryButton}>
            اشتراک‌گذاری کد دعوت
          </button>
        </div>

        {/* Transactions */}
<div style={panel}>
  <div style={smallTitle}>آخرین تراکنش‌ها</div>

  <Transaction
    title="سود روزانه"
    amount={`+ ${money(dailyProfit)} تومان`}
  />

  <Transaction
    title="پاداش دعوت دوست"
    amount="+ ۳۳ تومان"
  />

  <Transaction
    title="برداشت کیف پول"
    amount="- ۵۰٬۰۰۰ تومان"
    negative
  />
</div>
