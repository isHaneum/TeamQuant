import { fetchMarketSeries } from "../lib/market.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "GET 요청만 지원합니다." });
  }

  try {
    const data = await fetchMarketSeries(request.query.symbol || "005930.KS", request.query.range || "1y");
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return response.status(200).json(data);
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "시장 데이터 요청 시간이 초과되었습니다." : error.message;
    return response.status(400).json({ error: message });
  }
}
