from __future__ import annotations

from sds_origin_scraper.parsers.genshin_gg import GenshinGgAdapter
from sds_origin_scraper.parsers.hideout_gacha import HideoutGachaAdapter
from sds_origin_scraper.parsers.seven_ds_origin_gg import SevenDsOriginGgAdapter


def get_adapters(site: str):
    adapters = {
        "7dsorigin": SevenDsOriginGgAdapter(),
        "hideout": HideoutGachaAdapter(),
        "genshin": GenshinGgAdapter(),
    }
    if site == "all":
        return list(adapters.values())
    return [adapters[site]]
