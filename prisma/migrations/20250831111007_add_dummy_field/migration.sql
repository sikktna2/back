-- الخطوة 1: التأكد من تفعيل لغة البرمجة المطلوبة
CREATE EXTENSION IF NOT EXISTS plpgsql;

-- الخطوة 2: التأكد من تفعيل "المحرك الجغرافي" PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- الخطوة 3: الآن قم بإنشاء الدالة الآمنة التي تعالج الأخطاء
CREATE OR REPLACE FUNCTION safe_st_geogfromtext(text) 
RETURNS geography AS $$
BEGIN
    -- نحاول تحويل النص إلى نوع geography
    RETURN ST_GeogFromText($1);
EXCEPTION WHEN others THEN
    -- إذا فشلت المحاولة لأي سبب، نرجع قيمة فارغة بدلاً من إيقاف البرنامج
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;