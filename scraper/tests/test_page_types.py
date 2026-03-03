from bs4 import BeautifulSoup

from sds_origin_scraper.parsers.genshin_gg import GenshinGgAdapter
from sds_origin_scraper.parsers.hideout_gacha import HideoutGachaAdapter
from sds_origin_scraper.parsers.seven_ds_origin_gg import SevenDsOriginGgAdapter


EMPTY = BeautifulSoup("<html><head><title>x</title></head><body><h1>x</h1></body></html>", "lxml")


def test_7dsorigin_page_types():
    adapter = SevenDsOriginGgAdapter()
    assert adapter.page_type("https://7dsorigin.gg/", EMPTY) == "home"
    assert adapter.page_type("https://7dsorigin.gg/weapons", EMPTY) == "weapons_index"
    assert adapter.page_type("https://7dsorigin.gg/weapons/blazing-dual-swords", EMPTY) == "weapon_detail"
    assert adapter.page_type("https://7dsorigin.gg/boss/red-demon", EMPTY) == "boss_detail"


def test_hideout_page_types():
    adapter = HideoutGachaAdapter()
    assert adapter.page_type("https://www.hideoutgacha.com/games/seven-deadly-sins-origin", EMPTY) == "hub"
    assert adapter.page_type(
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/characters", EMPTY
    ) == "character_index"
    assert adapter.page_type(
        "https://www.hideoutgacha.com/games/seven-deadly-sins-origin/characters/meliodas", EMPTY
    ) == "character_guide"


def test_genshin_page_types():
    adapter = GenshinGgAdapter()
    assert adapter.page_type("https://genshin.gg/7dso/", EMPTY) == "character_index"
    assert adapter.page_type("https://genshin.gg/7dso/tier-list/", EMPTY) == "tier_list"
    assert adapter.page_type("https://genshin.gg/7dso/interactive-map/", EMPTY) == "interactive_map"
