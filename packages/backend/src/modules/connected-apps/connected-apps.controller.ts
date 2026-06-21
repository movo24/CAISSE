import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConnectedAppsService } from './connected-apps.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import {
  CreateConnectedAppDto,
  UpdateConnectedAppDto,
} from '../../common/dto';

@ApiTags('connected-apps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('connected-apps')
export class ConnectedAppsController {
  constructor(private service: ConnectedAppsService) {}

  @Get()
  @Roles('admin')
  @ApiOperation({ summary: 'List connected apps for organization' })
  async findAll(@Query('organizationId') organizationId: string) {
    const apps = await this.service.findAll(organizationId);
    // SECURITY (M406/D2): admin-only + never expose the third-party api_key over HTTP.
    return apps.map(({ apiKey, ...rest }) => rest);
  }

  @Get(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Get connected app by ID' })
  async findOne(@Param('id') id: string) {
    const { apiKey, ...rest } = await this.service.findOne(id);
    return rest;
  }

  @Post()
  @Roles('admin')
  @ApiOperation({ summary: 'Register a connected app' })
  create(@Body() dto: CreateConnectedAppDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a connected app' })
  update(@Param('id') id: string, @Body() dto: UpdateConnectedAppDto) {
    return this.service.update(id, dto);
  }

  @Put(':id/deactivate')
  @Roles('admin')
  @ApiOperation({ summary: 'Deactivate a connected app' })
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
