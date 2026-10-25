package clients

import (
	"elsewhere_server/kitex_gen/elsewhere/auth/authservice"
	"elsewhere_server/kitex_gen/elsewhere/feed/feedservice"
	"elsewhere_server/kitex_gen/elsewhere/item/itemservice"
	"elsewhere_server/kitex_gen/elsewhere/notification/notificationservice"
	"elsewhere_server/kitex_gen/elsewhere/pm/pmservice"
	"elsewhere_server/kitex_gen/elsewhere/profile/profileservice"
	"elsewhere_server/kitex_gen/elsewhere/sort/sortservice"
)

var (
	ProfileClient      profileservice.Client
	ItemClient         itemservice.Client
	FeedClient         feedservice.Client
	AuthClient         authservice.Client
	PMClient           pmservice.Client
	NotificationClient notificationservice.Client
	SortClient         sortservice.Client
)
